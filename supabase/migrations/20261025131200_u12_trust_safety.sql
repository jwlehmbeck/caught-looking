-- Trust and safety core (plan U12): reports, blocks, the mod queue, staff
-- actions, roles and invite codes. The tables come from core_schema; this
-- file adds the write paths. Every write is a security definer RPC that
-- checks the caller itself and logs to mod_actions.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's role: 'admin', 'mod' or null. user_roles is not readable by
-- clients, so pages ask through this.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.user_roles where user_id = (select auth.uid());
$$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- Has the signed-in viewer blocked this author? Feed, comment and chat RPCs
-- filter with this so blocked people disappear everywhere for the blocker.
create or replace function private.is_blocked_by_viewer(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_author is not null and exists (
    select 1 from public.blocks
    where blocker_id = (select auth.uid()) and blocked_id = p_author
  );
$$;
revoke all on function private.is_blocked_by_viewer(uuid) from public, anon;
grant execute on function private.is_blocked_by_viewer(uuid) to authenticated;

-- Who wrote a piece of content (or whose profile it is). Null when unknown.
create or replace function private.content_author(p_target_type text, p_target_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  if p_target_type = 'profile' then
    begin
      return p_target_id::uuid;
    exception when others then
      return null;
    end;
  end if;
  if p_target_id !~ '^[0-9]{1,18}$' then
    return null;
  end if;
  case p_target_type
    when 'post' then select author_id into v_author from public.posts where id = p_target_id::bigint;
    when 'comment' then select author_id into v_author from public.comments where id = p_target_id::bigint;
    when 'chat_message' then select author_id into v_author from public.chat_messages where id = p_target_id::bigint;
    when 'poll' then select created_by into v_author from public.polls where id = p_target_id::bigint;
    else v_author := null;
  end case;
  return v_author;
end;
$$;
revoke all on function private.content_author(text, text) from public, anon, authenticated;

-- Does the target exist?
create or replace function private.content_exists(p_target_type text, p_target_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_target_type = 'profile' then
    begin
      return exists (select 1 from public.profiles where id = p_target_id::uuid);
    exception when others then
      return false;
    end;
  end if;
  if p_target_id !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  return case p_target_type
    when 'post' then exists (select 1 from public.posts where id = p_target_id::bigint)
    when 'comment' then exists (select 1 from public.comments where id = p_target_id::bigint)
    when 'chat_message' then exists (select 1 from public.chat_messages where id = p_target_id::bigint)
    when 'poll' then exists (select 1 from public.polls where id = p_target_id::bigint)
    else false
  end;
end;
$$;
revoke all on function private.content_exists(text, text) from public, anon, authenticated;

-- A short preview of the target for the queue. Never personal data.
create or replace function private.content_snippet(p_target_type text, p_target_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_target_type = 'profile' then
    begin
      select username into v from public.profiles where id = p_target_id::uuid;
    exception when others then
      v := null;
    end;
    return v;
  end if;
  if p_target_id !~ '^[0-9]{1,18}$' then
    return null;
  end if;
  case p_target_type
    when 'post' then select title into v from public.posts where id = p_target_id::bigint;
    when 'comment' then select body into v from public.comments where id = p_target_id::bigint;
    when 'chat_message' then select body into v from public.chat_messages where id = p_target_id::bigint;
    when 'poll' then select question into v from public.polls where id = p_target_id::bigint;
    else v := null;
  end case;
  return left(v, 140);
end;
$$;
revoke all on function private.content_snippet(text, text) from public, anon, authenticated;

-- Admin alert for urgent / under-13 reports. U4's alert_log is admin-read
-- only and feeds the admin email; this writes to it directly because
-- private.record_alert only accepts the service role. Never fails the report.
create or replace function private.notify_admins(p_kind text, p_message text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.alert_log') is null then
    return;
  end if;
  begin
    execute 'insert into public.alert_log (kind, message, details) values ($1, $2, $3)'
      using p_kind, left(p_message, 1000), p_details;
  exception when others then
    raise warning 'alert_log insert failed: %', sqlerrm;
  end;
end;
$$;
revoke all on function private.notify_admins(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports and blocks (any member)
-- ---------------------------------------------------------------------------

-- File a report. 20 per person per rolling day. A second report of the same
-- thing by the same person is a no-op (the unique constraint dedupes).
-- Returns the report id.
create or replace function public.file_report(
  p_target_type text, p_target_id text, p_category text, p_details text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if private.is_sanctioned(v_uid, array['ban']) then
    raise exception 'your account is banned' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if p_target_type not in ('post', 'comment', 'chat_message', 'profile', 'poll') then
    raise exception 'unknown target type' using errcode = '22023';
  end if;
  if p_category not in ('spam', 'bullying', 'inappropriate', 'contact_info', 'under_13', 'urgent') then
    raise exception 'unknown category' using errcode = '22023';
  end if;
  if not private.content_exists(p_target_type, p_target_id) then
    raise exception 'nothing to report' using errcode = 'P0002';
  end if;
  if p_target_type = 'profile' and p_target_id = v_uid::text then
    raise exception 'you cannot report yourself' using errcode = '22023';
  end if;

  select count(*) into v_recent
    from public.reports
   where reporter_id = v_uid and created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'report limit reached, try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, category, details)
  values (v_uid, p_target_type, p_target_id, p_category, nullif(btrim(p_details), ''))
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.reports
     where reporter_id = v_uid and target_type = p_target_type and target_id = p_target_id;
    return v_id;
  end if;

  if p_category in ('under_13', 'urgent') then
    perform private.notify_admins(
      'urgent_report',
      'New ' || p_category || ' report needs an admin within 12 hours',
      jsonb_build_object('report_id', v_id, 'category', p_category,
                         'target_type', p_target_type, 'target_id', p_target_id)
    );
  end if;

  return v_id;
end;
$$;
revoke all on function public.file_report(text, text, text, text) from public, anon;
grant execute on function public.file_report(text, text, text, text) to authenticated;

create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'you cannot block yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  insert into public.blocks (blocker_id, blocked_id)
  values (v_uid, p_user_id)
  on conflict do nothing;
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks
   where blocker_id = (select auth.uid()) and blocked_id = p_user_id;
$$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff actions
-- ---------------------------------------------------------------------------

-- Resolve or dismiss every open report on the same target as p_report_id.
-- Mods cannot touch under_13/urgent reports or anything about themselves.
create or replace function public.resolve_report(p_report_id bigint, p_outcome text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
  r public.reports%rowtype;
  v_author uuid;
  v_count integer;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome not in ('resolved', 'dismissed') then
    raise exception 'outcome must be resolved or dismissed' using errcode = '22023';
  end if;

  select * into r from public.reports where id = p_report_id;
  if r.id is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if r.category in ('under_13', 'urgent') and not v_admin then
    raise exception 'only admins handle this report' using errcode = '42501';
  end if;

  v_author := private.content_author(r.target_type, r.target_id);
  if v_author = v_uid then
    raise exception 'you cannot act on reports about yourself' using errcode = '42501';
  end if;

  update public.reports
     set status = p_outcome, resolved_by = v_uid, resolved_at = now()
   where status = 'open'
     and target_type = r.target_type
     and target_id = r.target_id
     and (v_admin or category not in ('under_13', 'urgent'));
  get diagnostics v_count = row_count;

  perform private.log_mod_action(
    'report.' || p_outcome, r.target_type, r.target_id,
    jsonb_build_object('report_id', p_report_id, 'count', v_count)
  );
  return v_count;
end;
$$;
revoke all on function public.resolve_report(bigint, text) from public, anon;
grant execute on function public.resolve_report(bigint, text) to authenticated;

-- Hide (or unhide) a post, comment or chat message. Staff only, never on
-- your own content. Unhiding only brings back content that is hidden.
create or replace function public.hide_content(p_target_type text, p_target_id text, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_count integer;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_target_type not in ('post', 'comment', 'chat_message') then
    raise exception 'can only hide posts, comments and chat messages' using errcode = '22023';
  end if;
  if p_target_id !~ '^[0-9]{1,18}$' then
    raise exception 'bad target id' using errcode = '22023';
  end if;
  v_id := p_target_id::bigint;
  if private.content_author(p_target_type, p_target_id) = v_uid then
    raise exception 'you cannot act on your own content' using errcode = '42501';
  end if;

  if p_hidden then
    case p_target_type
      when 'post' then update public.posts set status = 'hidden' where id = v_id and status = 'live';
      when 'comment' then update public.comments set status = 'hidden' where id = v_id and status = 'live';
      when 'chat_message' then update public.chat_messages set status = 'hidden' where id = v_id and status = 'live';
    end case;
  else
    case p_target_type
      when 'post' then update public.posts set status = 'live' where id = v_id and status = 'hidden';
      when 'comment' then update public.comments set status = 'live' where id = v_id and status = 'hidden';
      when 'chat_message' then update public.chat_messages set status = 'live' where id = v_id and status = 'hidden';
    end case;
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'nothing to change' using errcode = 'P0002';
  end if;

  perform private.log_mod_action(
    case when p_hidden then 'content.hide' else 'content.unhide' end,
    p_target_type, p_target_id, null
  );
end;
$$;
revoke all on function public.hide_content(text, text, boolean) from public, anon;
grant execute on function public.hide_content(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

create or replace function public.lift_sanction(p_sanction_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sanctions%rowtype;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.sanctions set lifted_at = now()
   where id = p_sanction_id and lifted_at is null
   returning * into s;
  if s.id is null then
    raise exception 'no active sanction with that id' using errcode = 'P0002';
  end if;
  perform private.log_mod_action(
    'sanction.lift', 'profile', s.user_id::text,
    jsonb_build_object('sanction_id', s.id, 'kind', s.kind)
  );
end;
$$;
revoke all on function public.lift_sanction(bigint) from public, anon;
grant execute on function public.lift_sanction(bigint) to authenticated;

-- Appoint or remove a mod or admin. Null role removes. Admins cannot change
-- their own role, so there is always someone left who can.
create or replace function public.set_user_role(p_user_id uuid, p_role text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('mod', 'admin') then
    raise exception 'role must be mod, admin or null' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'no such active user' using errcode = 'P0002';
  end if;

  if p_role is null then
    delete from public.user_roles where user_id = p_user_id;
  else
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, v_uid)
    on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  end if;

  perform private.log_mod_action(
    'role.set', 'profile', p_user_id::text, jsonb_build_object('role', p_role)
  );
end;
$$;
revoke all on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- Invite codes are stored hashed; U3's signup checks a typed code with this.
create or replace function private.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(upper(replace(btrim(p_code), ' ', '')), 'sha256'), 'hex');
$$;
revoke all on function private.hash_invite_code(text) from public, anon, authenticated;

-- Generate invite codes shaped XXXX-XXXX from an alphabet without 0/O/1/I.
-- Returns the plain codes: this is the only time anyone sees them.
create or replace function public.create_invite_codes(
  p_count integer default 1, p_max_uses integer default 1, p_expires_at timestamptz default null
)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
  v_ids uuid[] := '{}';
  v_id uuid;
  i integer;
  j integer;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 100 then
    raise exception 'count must be between 1 and 100' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'max uses must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expiry must be in the future' using errcode = '22023';
  end if;

  for i in 1..p_count loop
    loop
      v_bytes := extensions.gen_random_bytes(8);
      v_code := '';
      for j in 0..7 loop
        v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, j) % 32) + 1, 1);
        if j = 3 then v_code := v_code || '-'; end if;
      end loop;
      exit when not exists (
        select 1 from public.invite_codes where code_hash = private.hash_invite_code(v_code)
      );
    end loop;

    insert into public.invite_codes (code_hash, created_by, max_uses, expires_at)
    values (private.hash_invite_code(v_code), (select auth.uid()), p_max_uses, p_expires_at)
    returning id into v_id;
    v_ids := v_ids || v_id;

    return next v_code;
  end loop;

  perform private.log_mod_action(
    'invite.create', 'invite_codes', 'batch',
    jsonb_build_object('count', p_count, 'max_uses', p_max_uses, 'expires_at', p_expires_at, 'ids', to_jsonb(v_ids))
  );
  return;
end;
$$;
revoke all on function public.create_invite_codes(integer, integer, timestamptz) from public, anon;
grant execute on function public.create_invite_codes(integer, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The mod queue
-- ---------------------------------------------------------------------------

-- Open reports grouped by target. Mods never see under_13/urgent. Admins see
-- urgent groups first, then everyone sees the most-reported first.
create or replace function public.mod_queue()
returns table (
  target_type        text,
  target_id          text,
  report_id          bigint,
  report_count       integer,
  categories         text[],
  first_reported_at  timestamptz,
  last_reported_at   timestamptz,
  snippet            text,
  author_id          uuid,
  author_username    text,
  urgent             boolean,
  details            text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := private.is_admin();
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    with grouped as (
      select
        r.target_type,
        r.target_id,
        min(r.id) as report_id,
        count(*)::integer as report_count,
        array_agg(distinct r.category order by r.category) as categories,
        min(r.created_at) as first_reported_at,
        max(r.created_at) as last_reported_at,
        bool_or(r.category in ('under_13', 'urgent')) as urgent,
        array_remove(array_agg(r.details order by r.created_at), null) as details
      from public.reports r
      where r.status = 'open'
        and (v_admin or r.category not in ('under_13', 'urgent'))
      group by r.target_type, r.target_id
    )
    select
      g.target_type,
      g.target_id,
      g.report_id,
      g.report_count,
      g.categories,
      g.first_reported_at,
      g.last_reported_at,
      private.content_snippet(g.target_type, g.target_id) as snippet,
      a.author_id,
      p.username as author_username,
      g.urgent,
      g.details[1:5] as details
    from grouped g
    cross join lateral (select private.content_author(g.target_type, g.target_id) as author_id) a
    left join public.profiles p on p.id = a.author_id
    order by g.urgent desc, g.report_count desc, g.first_reported_at asc;
end;
$$;
revoke all on function public.mod_queue() from public, anon;
grant execute on function public.mod_queue() to authenticated;

-- Active sanctions for the queue's Ban/Suspend/Mute buttons and for appeals.
create or replace function public.active_sanctions(p_user_id uuid)
returns setof public.sanctions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.sanctions
   where user_id = p_user_id
     and lifted_at is null
     and (ends_at is null or ends_at > now())
     and (private.is_staff() or user_id = (select auth.uid()))
   order by created_at desc;
$$;
revoke all on function public.active_sanctions(uuid) from public, anon;
grant execute on function public.active_sanctions(uuid) to authenticated;
