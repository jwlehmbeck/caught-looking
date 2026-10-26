-- U11: fan edit uploads with pre-moderation.
--
-- Flow: the client uploads with TUS to the private `uploads` bucket at
-- uploads/{user_id}/{uuid}.(mp4|mov), the server action registers the post
-- (status 'pending'), a storage webhook calls scan-upload which marks it
-- 'scanning' and starts the scanners, scan-complete / scan-sweep apply the
-- outcome, and an admin approves from the Uploads tab (status 'live', file
-- copied to `media/{sha256}.mp4`). Nothing a member uploads is visible to
-- anyone else until an admin approves it.
--
-- Everything that needs the storage schema, pg_cron, pg_net, vault or the
-- supabase_functions webhook helper is guarded so the migration applies on
-- a bare Postgres (the local pgTAP stand-in).

-- ---------------------------------------------------------------------------
-- alert_log gains the quarantine kind
-- ---------------------------------------------------------------------------

alter table public.alert_log drop constraint if exists alert_log_kind_check;
alter table public.alert_log add constraint alert_log_kind_check check (kind in (
  'poller_failure', 'scorer_failure', 'upload_auto_rejected',
  'scan_timeout', 'csam_quarantine', 'urgent_report', 'other'));

-- ---------------------------------------------------------------------------
-- upload_scans: one row per fan edit, the scanners' bookkeeping
-- ---------------------------------------------------------------------------

create table public.upload_scans (
  post_id             bigint primary key references public.posts (id) on delete cascade,
  s3_key              text,
  rekognition_job_id  text,
  csam_checked        boolean not null default false,
  csam_match          boolean not null default false,
  labels              jsonb,
  duration_ms         integer,
  status              text not null default 'queued'
                      check (status in ('queued', 'scanning', 'complete', 'timeout', 'error')),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);
comment on table public.upload_scans is 'Scanner state per fan edit (Rekognition job, CSAM check, outcome). Admin read only.';
create index upload_scans_status_idx on public.upload_scans (status, started_at);
select private.lock_down('public.upload_scans');
grant select on public.upload_scans to authenticated;
grant select, insert, update, delete on public.upload_scans to service_role;

create policy "upload_scans: admins read" on public.upload_scans
  for select to authenticated
  using (private.is_admin());

-- One post per uploaded file.
create unique index if not exists posts_storage_path_uidx on public.posts (storage_path) where storage_path is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Fan edits this person registered in the last 24 hours (rejected ones count
-- too, so a rejection cannot be retried without limit).
create or replace function private.uploads_in_last_day(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.posts
   where author_id = p_user_id
     and kind = 'fan_edit'
     and created_at > now() - interval '24 hours';
$$;
revoke all on function private.uploads_in_last_day(uuid) from public, anon, authenticated;

-- May this person start an upload right now? Used by the storage INSERT
-- policy (so it must be callable by authenticated) and by uploads_register.
create or replace function private.can_upload(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (select 1 from public.profiles where id = p_user_id and status = 'active')
     and not private.is_sanctioned(p_user_id, array['suspension', 'ban'])
     and private.uploads_in_last_day(p_user_id) < 3;
$$;
revoke all on function private.can_upload(uuid) from public, anon;
grant execute on function private.can_upload(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: buckets and object policies (guarded; the stand-in has no storage)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage')
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise notice 'storage schema missing; skipping bucket and object policy setup';
    return;
  end if;

  -- 150 MB cap; the client checks size and length first, scan-upload again.
  -- image/jpeg is for the thumbnail the server action stores next to the
  -- video; members themselves may only insert mp4/mov (policy below).
  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('uploads', 'uploads', false, 157286400, array['video/mp4', 'video/quicktime', 'image/jpeg'])
    on conflict (id) do nothing
  $sql$;
  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', false, 157286400, array['video/mp4', 'video/quicktime', 'image/jpeg'])
    on conflict (id) do nothing
  $sql$;

  -- INSERT: only into your own folder, only video, only while under the
  -- daily cap and not suspended. Write-once: there is no UPDATE policy, so
  -- x-upsert and overwrites fail.
  execute 'drop policy if exists "uploads: owner inserts video" on storage.objects';
  execute $sql$
    create policy "uploads: owner inserts video" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and lower(storage.extension(name)) in ('mp4', 'mov')
        and private.can_upload((select auth.uid()))
      )
  $sql$;

  -- SELECT: owners see their own objects (the app serves them through
  -- signed URLs made with the service role anyway).
  execute 'drop policy if exists "uploads: owner reads" on storage.objects';
  execute $sql$
    create policy "uploads: owner reads" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $sql$;

  -- DELETE: owners may take a file back only while nothing has been decided
  -- (no post yet, or the post is still pending/scanning). Live, rejected and
  -- held files stay until the service role purges them.
  execute 'drop policy if exists "uploads: owner deletes undecided" on storage.objects';
  execute $sql$
    create policy "uploads: owner deletes undecided" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not exists (
          select 1 from public.posts p
           where p.storage_path = 'uploads/' || name
             and p.status not in ('pending', 'scanning')
        )
      )
  $sql$;

  -- `media` has no member policies at all: the service role copies approved
  -- files in and mints short-lived signed URLs.
end;
$$;

-- ---------------------------------------------------------------------------
-- Service RPCs (called by the server action and the scan functions)
-- ---------------------------------------------------------------------------

-- Registers an uploaded file as a pending fan edit. The server action has
-- already filtered the title and checked duration/size on the client's word;
-- the cap, sanctions and the path shape are checked again here.
create or replace function public.uploads_register(
  p_user_id uuid,
  p_storage_path text,
  p_title text,
  p_team_id smallint default null,
  p_game_id bigint default null,
  p_client_duration smallint default null,
  p_thumbnail_path text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_id bigint;
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if private.is_sanctioned(p_user_id, array['suspension', 'ban']) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if private.uploads_in_last_day(p_user_id) >= 3 then
    raise exception 'upload limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
  if p_storage_path !~ ('^uploads/' || p_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov)$') then
    raise exception 'bad storage path' using errcode = '22023';
  end if;
  if p_thumbnail_path is not null
     and p_thumbnail_path !~ ('^uploads/' || p_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'bad thumbnail path' using errcode = '22023';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 140 then
    raise exception 'title must be 1 to 140 characters' using errcode = '22023';
  end if;
  if p_client_duration is not null and (p_client_duration < 1 or p_client_duration > 60) then
    raise exception 'clips are 60 seconds or less' using errcode = '22023';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'unknown team' using errcode = '22023';
  end if;
  if p_game_id is not null and not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'unknown game' using errcode = '22023';
  end if;
  if exists (select 1 from public.posts where storage_path = p_storage_path) then
    raise exception 'already registered' using errcode = '23505';
  end if;

  insert into public.posts (author_id, kind, status, title, storage_path, thumbnail_path, duration_seconds, team_id, game_id)
  values (p_user_id, 'fan_edit', 'pending', v_title, p_storage_path, p_thumbnail_path, p_client_duration, p_team_id, p_game_id)
  returning id into v_id;

  insert into public.upload_scans (post_id, status) values (v_id, 'queued');
  return v_id;
end;
$$;
revoke all on function public.uploads_register(uuid, text, text, smallint, bigint, smallint, text) from public, anon, authenticated;
grant execute on function public.uploads_register(uuid, text, text, smallint, bigint, smallint, text) to service_role;

-- scan-upload passed the cheap checks and started the scanners.
create or replace function public.uploads_mark_scanning(p_post_id bigint, p_job_id text default null, p_s3_key text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.posts
     set status = 'scanning', scan_job_id = coalesce(p_job_id, scan_job_id)
   where id = p_post_id and kind = 'fan_edit' and status in ('pending', 'scanning');
  if not found then
    raise exception 'upload not found or already decided' using errcode = 'P0002';
  end if;
  insert into public.upload_scans (post_id, status, rekognition_job_id, s3_key, started_at)
  values (p_post_id, 'scanning', p_job_id, p_s3_key, now())
  on conflict (post_id) do update
     set status = 'scanning',
         rekognition_job_id = coalesce(excluded.rekognition_job_id, public.upload_scans.rekognition_job_id),
         s3_key = coalesce(excluded.s3_key, public.upload_scans.s3_key),
         started_at = coalesce(public.upload_scans.started_at, now());
end;
$$;
revoke all on function public.uploads_mark_scanning(bigint, text, text) from public, anon, authenticated;
grant execute on function public.uploads_mark_scanning(bigint, text, text) to service_role;

-- Applies a scan outcome. Idempotent: a post that is no longer pending or
-- scanning (already approved, rejected or held) is left alone, so a late
-- SNS callback after the sweep cannot flip a decision.
--
--   quarantine       -> status 'held', csam_quarantine alert; never in a queue
--   reject           -> status 'rejected' with p_details->>'reason'
--                       (unsafe labels also alert the admin)
--   queue            -> status 'pending', scan complete, into the admin queue
--   queue_unscanned  -> status 'pending', scan timeout/error, queue shows it
--                       as unscanned
create or replace function public.uploads_apply_scan(p_post_id bigint, p_outcome text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_reason text := v_details ->> 'reason';
  v_duration_ms integer;
  v_labels jsonb := case when jsonb_typeof(v_details -> 'labels') = 'array' then v_details -> 'labels' else null end;
  v_csam_checked boolean := coalesce((v_details ->> 'csam_checked')::boolean, false);
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome not in ('queue', 'queue_unscanned', 'reject', 'quarantine') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;

  select * into v_post from public.posts where id = p_post_id and kind = 'fan_edit';
  if v_post.id is null then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;
  if v_post.status not in ('pending', 'scanning') then
    return;
  end if;

  begin
    v_duration_ms := (v_details ->> 'duration_ms')::integer;
  exception when others then
    v_duration_ms := null;
  end;

  insert into public.upload_scans (post_id) values (p_post_id) on conflict (post_id) do nothing;

  if p_outcome = 'quarantine' then
    update public.posts set status = 'held' where id = p_post_id;
    update public.upload_scans
       set status = 'complete', csam_checked = true, csam_match = true,
           labels = coalesce(v_labels, labels), duration_ms = coalesce(v_duration_ms, duration_ms),
           completed_at = now()
     where post_id = p_post_id;
    perform private.record_alert(
      'csam_quarantine',
      'Upload quarantined after a hash match. Follow docs/policies/csam-procedure.md. Do not open the file.',
      jsonb_build_object('post_id', p_post_id, 'author_id', v_post.author_id, 'storage_path', v_post.storage_path)
    );
    return;
  end if;

  if p_outcome = 'reject' then
    if v_reason is null or v_reason not in ('copyright', 'personal_info', 'contact_info', 'off_topic', 'quality', 'unsafe') then
      v_reason := 'unsafe';
    end if;
    update public.posts set status = 'rejected', rejection_reason = v_reason where id = p_post_id;
    update public.upload_scans
       set status = 'complete', csam_checked = v_csam_checked or csam_checked,
           labels = coalesce(v_labels, labels), duration_ms = coalesce(v_duration_ms, duration_ms),
           completed_at = now()
     where post_id = p_post_id;
    insert into public.deletion_queue (storage_path) values (v_post.storage_path) on conflict do nothing;
    if v_reason = 'unsafe' then
      perform private.record_alert(
        'upload_auto_rejected',
        'Upload auto-rejected by the content scanner.',
        jsonb_build_object('post_id', p_post_id, 'author_id', v_post.author_id, 'labels', v_labels)
      );
    end if;
    return;
  end if;

  -- queue / queue_unscanned
  update public.posts
     set status = 'pending', scan_job_id = coalesce(v_details ->> 'job_id', scan_job_id)
   where id = p_post_id;
  if p_outcome = 'queue' then
    update public.upload_scans
       set status = 'complete', csam_checked = v_csam_checked or csam_checked,
           labels = coalesce(v_labels, labels), duration_ms = coalesce(v_duration_ms, duration_ms),
           completed_at = now()
     where post_id = p_post_id;
  else
    update public.upload_scans
       set status = case when v_reason = 'timeout' then 'timeout' else 'error' end,
           csam_checked = v_csam_checked or csam_checked,
           labels = coalesce(v_labels, labels), duration_ms = coalesce(v_duration_ms, duration_ms),
           completed_at = now()
     where post_id = p_post_id;
    if v_reason = 'timeout' then
      perform private.record_alert(
        'scan_timeout',
        'A content scan never finished; the upload is in the queue marked unscanned.',
        jsonb_build_object('post_id', p_post_id)
      );
    end if;
  end if;
end;
$$;
revoke all on function public.uploads_apply_scan(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.uploads_apply_scan(bigint, text, jsonb) to service_role;

-- Scans still running after 15 minutes, for the sweep.
create or replace function public.uploads_pending_scans(p_older_than interval default interval '15 minutes')
returns table (post_id bigint, rekognition_job_id text, s3_key text, started_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select s.post_id, s.rekognition_job_id, s.s3_key, s.started_at
      from public.upload_scans s
      join public.posts p on p.id = s.post_id
     where s.status = 'scanning'
       and p.status = 'scanning'
       and s.started_at <= now() - coalesce(p_older_than, interval '15 minutes')
     order by s.started_at;
end;
$$;
revoke all on function public.uploads_pending_scans(interval) from public, anon, authenticated;
grant execute on function public.uploads_pending_scans(interval) to service_role;

-- ---------------------------------------------------------------------------
-- Staff RPCs (admin only: uploads are a child-safety surface)
-- ---------------------------------------------------------------------------

-- Approves a pending upload. The server action has already copied the file
-- to media/{sha256}.(mp4|mov); this flips the post live and queues the
-- original for purging.
create or replace function public.approve_upload(p_post_id bigint, p_media_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_media_path !~ '^media/[0-9a-f]{64}\.(mp4|mov)$' then
    raise exception 'bad media path' using errcode = '22023';
  end if;
  select * into v_post from public.posts where id = p_post_id and kind = 'fan_edit';
  if v_post.id is null then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'pending' then
    raise exception 'only pending uploads can be approved' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.upload_scans where post_id = p_post_id and csam_match) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.posts
     set status = 'live', published_at = now(), storage_path = p_media_path, rejection_reason = null
   where id = p_post_id;
  insert into public.deletion_queue (storage_path) values (v_post.storage_path) on conflict do nothing;
  perform private.log_mod_action('approve_upload', 'post', p_post_id::text,
    jsonb_build_object('from', v_post.storage_path, 'to', p_media_path));
end;
$$;
revoke all on function public.approve_upload(bigint, text) from public, anon;
grant execute on function public.approve_upload(bigint, text) to authenticated;

-- Rejects a pending or scanning upload with a reason from the fixed list.
create or replace function public.reject_upload(p_post_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('copyright', 'personal_info', 'contact_info', 'off_topic', 'quality', 'unsafe') then
    raise exception 'pick a reason from the list' using errcode = '22023';
  end if;
  select * into v_post from public.posts where id = p_post_id and kind = 'fan_edit';
  if v_post.id is null then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;
  if v_post.status not in ('pending', 'scanning') then
    raise exception 'only pending uploads can be rejected' using errcode = 'P0002';
  end if;

  update public.posts set status = 'rejected', rejection_reason = p_reason where id = p_post_id;
  insert into public.deletion_queue (storage_path) values (v_post.storage_path) on conflict do nothing;
  perform private.log_mod_action('reject_upload', 'post', p_post_id::text, jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.reject_upload(bigint, text) from public, anon;
grant execute on function public.reject_upload(bigint, text) to authenticated;

-- The admin approval queue: pending fan edits with their scan state. Held
-- (quarantined) uploads never appear here; only the CSAM procedure touches
-- them.
create or replace function public.upload_queue()
returns table (
  id                bigint,
  title             text,
  author_id         uuid,
  author_username   text,
  team_abbreviation text,
  storage_path      text,
  thumbnail_path    text,
  duration_seconds  smallint,
  created_at        timestamptz,
  scan_status       text,
  labels            jsonb,
  duration_ms       integer,
  csam_checked      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.title, p.author_id, pr.username, t.abbreviation,
           p.storage_path, p.thumbnail_path, p.duration_seconds, p.created_at,
           coalesce(s.status, 'queued') as scan_status, s.labels, s.duration_ms, coalesce(s.csam_checked, false)
      from public.posts p
      left join public.upload_scans s on s.post_id = p.id
      left join public.profiles pr on pr.id = p.author_id
      left join public.teams t on t.id = p.team_id
     where p.kind = 'fan_edit'
       and p.status = 'pending'
       and coalesce(s.csam_match, false) = false
     order by p.created_at, p.id;
end;
$$;
revoke all on function public.upload_queue() from public, anon;
grant execute on function public.upload_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- Member RPC: my uploads
-- ---------------------------------------------------------------------------

-- The viewer's own fan edits. A quarantined upload shows as 'pending' to its
-- uploader; nothing in the app ever says "held".
create or replace function public.my_uploads()
returns table (
  id                bigint,
  title             text,
  status            text,
  rejection_reason  text,
  thumbnail_path    text,
  duration_seconds  smallint,
  team_abbreviation text,
  created_at        timestamptz,
  published_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title,
         case when p.status = 'held' then 'pending' else p.status end as status,
         case when p.status = 'rejected' then p.rejection_reason end as rejection_reason,
         p.thumbnail_path, p.duration_seconds, t.abbreviation, p.created_at, p.published_at
    from public.posts p
    left join public.teams t on t.id = p.team_id
   where p.kind = 'fan_edit'
     and p.author_id = (select auth.uid())
     and (select auth.uid()) is not null
   order by p.created_at desc, p.id desc;
$$;
revoke all on function public.my_uploads() from public, anon;
grant execute on function public.my_uploads() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage webhook: storage.objects insert -> scan-upload (guarded)
--
-- Production needs Vault secrets scan_upload_url and internal_function_secret
-- and the supabase_functions schema (Database Webhooks enabled). Where any
-- of those is missing, create the webhook from the dashboard instead:
--   Database > Webhooks > table storage.objects, event INSERT, type HTTP,
--   URL https://<ref>.supabase.co/functions/v1/scan-upload,
--   header x-internal-secret: <INTERNAL_FUNCTION_SECRET>.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') or to_regclass('storage.objects') is null then
    raise notice 'storage schema missing; skipping scan-upload webhook';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'supabase_functions') then
    raise notice 'supabase_functions schema missing; create the scan-upload webhook from the dashboard';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault missing; create the scan-upload webhook from the dashboard';
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''scan_upload_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret'' limit 1' into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'vault secrets scan_upload_url / internal_function_secret missing; create the scan-upload webhook from the dashboard';
    return;
  end if;

  execute 'drop trigger if exists scan_upload_webhook on storage.objects';
  execute format(
    $trg$
      create trigger scan_upload_webhook
      after insert on storage.objects
      for each row
      when (new.bucket_id = 'uploads')
      execute function supabase_functions.http_request(%L, 'POST', %L, '{}', '5000')
    $trg$,
    v_url,
    jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret)::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: scan-sweep every 10 minutes (same guarded pattern as poll-games).
-- Vault secrets: scan_sweep_url, internal_function_secret.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping scan-sweep schedule';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net not installed; skipping scan-sweep schedule';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault not installed; skipping scan-sweep schedule';
    return;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''scan_sweep_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret'' limit 1' into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'vault secrets scan_sweep_url / internal_function_secret missing; skipping scan-sweep schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'scan-sweep';
  perform cron.schedule(
    'scan-sweep',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'scan_sweep_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_function_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end;
$$;
