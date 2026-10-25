-- PostgREST only exposes the `public` schema, so the server actions (which
-- call supabase-js .rpc() with the service role) cannot reach private.*
-- directly. These wrappers are service-only: every one checks
-- private.is_service() and is revoked from client roles.

create or replace function public.auth_redeem_invite_code(p_code text, p_consume boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.redeem_invite_code(p_code, p_consume);
end; $$;

create or replace function public.auth_username_available(p_normalized text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.username_available(p_normalized);
end; $$;

create or replace function public.auth_signup_create_profile(
  p_user_id uuid, p_username text, p_normalized text, p_team smallint, p_birth_year smallint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.signup_create_profile(p_user_id, p_username, p_normalized, p_team, p_birth_year);
end; $$;

create or replace function public.auth_lookup_login(p_normalized_username text)
returns table (user_id uuid, status text) language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select * from private.lookup_login(p_normalized_username);
end; $$;

create or replace function public.auth_set_recovery_code(p_user_id uuid, p_code_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.set_recovery_code(p_user_id, p_code_hash);
end; $$;

create or replace function public.auth_get_recovery_hash(p_normalized_username text)
returns table (user_id uuid, code_hash text, locked boolean) language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select * from private.get_recovery_hash(p_normalized_username);
end; $$;

create or replace function public.auth_record_recovery_result(p_user_id uuid, p_ok boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.record_recovery_result(p_user_id, p_ok);
end; $$;

create or replace function public.auth_recovery_ip_allowed(p_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.recovery_ip_allowed(p_ip_hash);
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.auth_redeem_invite_code(text, boolean)',
    'public.auth_username_available(text)',
    'public.auth_signup_create_profile(uuid, text, text, smallint, smallint)',
    'public.auth_lookup_login(text)',
    'public.auth_set_recovery_code(uuid, text)',
    'public.auth_get_recovery_hash(text)',
    'public.auth_record_recovery_result(uuid, boolean)',
    'public.auth_recovery_ip_allowed(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
