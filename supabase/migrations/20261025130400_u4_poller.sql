-- U4: admin alert log, poller failure counter, and the poll-games cron job.

-- ---------------------------------------------------------------------------
-- alert_log: every admin alert the poller, scorer or moderation code sends.
-- Admins read it in the app; nobody else can see it, nobody writes it from
-- a browser (service role inserts directly, SQL callers use record_alert).
-- ---------------------------------------------------------------------------

create table public.alert_log (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in (
                'poller_failure', 'scorer_failure', 'upload_auto_rejected',
                'scan_timeout', 'urgent_report', 'other')),
  message     text not null check (char_length(message) between 1 and 1000),
  details     jsonb,
  created_at  timestamptz not null default now()
);
comment on table public.alert_log is 'Admin alerts sent by internal functions. Admin-read only.';
create index alert_log_created_idx on public.alert_log (created_at desc);
select private.lock_down('public.alert_log');
grant select on public.alert_log to authenticated;
grant select, insert on public.alert_log to service_role;

create policy "alert_log: admins only" on public.alert_log
  for select to authenticated
  using (private.is_admin());

-- Record an alert from SQL (cron bodies, triggers, the scorer). Service only.
create or replace function private.record_alert(p_kind text, p_message text, p_details jsonb default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not private.is_service() then
    raise exception 'only internal functions may record alerts' using errcode = '42501';
  end if;
  insert into public.alert_log (kind, message, details)
  values (p_kind, left(p_message, 1000), p_details)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_alert(text, text, jsonb) from public, anon, authenticated;
grant execute on function private.record_alert(text, text, jsonb) to service_role;

-- The poller's consecutive-failure counter lives in app_settings.
insert into public.app_settings (key, value)
values ('poller_failures', '{"count": 0, "lastError": null, "lastFailureAt": null, "lastAlertAt": null}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Cron: call poll-games every 2 minutes.
--
-- Production needs two Vault secrets (Dashboard > Project Settings > Vault):
--   poll_games_url            https://<project-ref>.supabase.co/functions/v1/poll-games
--   internal_function_secret  the same value as the Edge Function secret
--                             INTERNAL_FUNCTION_SECRET
--
-- The block below is a no-op where pg_cron, pg_net or vault are missing
-- (the local pgTAP stand-in) and where the secrets have not been created
-- yet, so this migration always applies. Re-run it (or `select
-- cron.schedule(...)` by hand) after the secrets exist.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping poll-games schedule';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net not installed; skipping poll-games schedule';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault not installed; skipping poll-games schedule';
    return;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''poll_games_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret'' limit 1' into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'vault secrets poll_games_url / internal_function_secret missing; skipping poll-games schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'poll-games';
  perform cron.schedule(
    'poll-games',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'poll_games_url'),
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
