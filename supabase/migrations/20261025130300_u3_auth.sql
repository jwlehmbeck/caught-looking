-- Signup, login and recovery (plan U3).
--
-- Everything here is called by the server actions through the service-role
-- client. No function in this file is executable by anon or authenticated,
-- and each one also checks private.is_service() in case a grant slips later.
-- The browser never sees the username-to-id mapping, invite hashes or
-- recovery hashes: it only ever posts a form to a server action.

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------

-- Checks a typed invite code and, when p_consume is true, counts one use.
-- Returns true when the code is good (or when public signup is open and no
-- code was given). Hashing reuses U12's private.hash_invite_code so codes
-- made by create_invite_codes match.
create or replace function private.redeem_invite_code(p_code text, p_consume boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open boolean;
  v_hash text;
  v_id uuid;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select coalesce((value)::boolean, false) into v_open
    from public.app_settings where key = 'public_signup_open';

  if coalesce(v_open, false) and nullif(btrim(coalesce(p_code, '')), '') is null then
    return true;
  end if;
  if nullif(btrim(coalesce(p_code, '')), '') is null then
    return false;
  end if;

  v_hash := private.hash_invite_code(p_code);

  if p_consume then
    update public.invite_codes
       set used_count = used_count + 1
     where code_hash = v_hash
       and used_count < max_uses
       and (expires_at is null or expires_at > now())
     returning id into v_id;
  else
    select id into v_id
      from public.invite_codes
     where code_hash = v_hash
       and used_count < max_uses
       and (expires_at is null or expires_at > now());
  end if;

  return v_id is not null;
end;
$$;
revoke all on function private.redeem_invite_code(text, boolean) from public, anon, authenticated;
grant execute on function private.redeem_invite_code(text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- Is this normalized username free to register right now? Reserved, held
-- and taken names all answer false. The server action runs the full filter
-- pipeline first; this is the database's last word.
create or replace function private.username_available(p_normalized text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_normalized ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.reserved_usernames where normalized = p_normalized)
     and not exists (select 1 from public.username_holds where normalized_username = p_normalized and released_at > now())
     and not exists (select 1 from public.profiles where normalized_username = p_normalized);
$$;
revoke all on function private.username_available(text) from public, anon, authenticated;
grant execute on function private.username_available(text) to service_role;

-- Creates the profile and its private row in one transaction, after the
-- auth user exists. Raises so the caller can delete the auth user again.
create or replace function private.signup_create_profile(
  p_user_id uuid, p_username text, p_normalized text, p_team smallint, p_birth_year smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if exists (select 1 from public.reserved_usernames where normalized = p_normalized) then
    raise exception 'username is reserved' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.username_holds where normalized_username = p_normalized and released_at > now()) then
    raise exception 'username is held' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where normalized_username = p_normalized) then
    raise exception 'username is taken' using errcode = '23505';
  end if;
  if not exists (select 1 from public.teams where id = p_team) then
    raise exception 'unknown team' using errcode = '23503';
  end if;

  insert into public.profiles (id, username, normalized_username, favorite_team_id)
  values (p_user_id, p_username, p_normalized, p_team);

  insert into public.profiles_private (user_id, birth_year, age_verified_13_plus)
  values (p_user_id, p_birth_year, true);
end;
$$;
revoke all on function private.signup_create_profile(uuid, text, text, smallint, smallint) from public, anon, authenticated;
grant execute on function private.signup_create_profile(uuid, text, text, smallint, smallint) to service_role;

-- Resolves a normalized username to the id the login action needs to build
-- the synthetic email. Only active profiles resolve.
create or replace function private.lookup_login(p_normalized_username text)
returns table (user_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, status
    from public.profiles
   where normalized_username = p_normalized_username
     and status = 'active'
     and private.is_service();
$$;
revoke all on function private.lookup_login(text) from public, anon, authenticated;
grant execute on function private.lookup_login(text) to service_role;

-- ---------------------------------------------------------------------------
-- Recovery codes
-- ---------------------------------------------------------------------------

-- Stores a new (bcrypt) hash and retires every earlier code.
create or replace function private.set_recovery_code(p_user_id uuid, p_code_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  update public.recovery_codes set used_at = now()
   where user_id = p_user_id and used_at is null;
  insert into public.recovery_codes (user_id, code_hash, created_at)
  values (p_user_id, p_code_hash, clock_timestamp());
end;
$$;
revoke all on function private.set_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function private.set_recovery_code(uuid, text) to service_role;

-- The newest unused hash for a username, plus whether recovery is locked.
-- The server action compares with bcrypt and then calls
-- record_recovery_result. No row means the username does not exist; the
-- action still burns a comparison so timing gives nothing away.
create or replace function private.get_recovery_hash(p_normalized_username text)
returns table (user_id uuid, code_hash text, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         rc.code_hash,
         coalesce(pp.recovery_locked_until > now(), false)
    from public.profiles p
    join public.profiles_private pp on pp.user_id = p.id
    left join lateral (
      select code_hash from public.recovery_codes
       where user_id = p.id and used_at is null
       order by created_at desc limit 1
    ) rc on true
   where p.normalized_username = p_normalized_username
     and p.status = 'active'
     and private.is_service();
$$;
revoke all on function private.get_recovery_hash(text) from public, anon, authenticated;
grant execute on function private.get_recovery_hash(text) to service_role;

-- Records one recovery attempt. A failure counts toward the lock (5 in a
-- row lock recovery for an hour); a success resets the counter and marks
-- the current code used. Returns true when the account is now locked.
create or replace function private.record_recovery_result(p_user_id uuid, p_ok boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts smallint;
  v_locked_until timestamptz;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select recovery_failed_attempts, recovery_locked_until
    into v_attempts, v_locked_until
    from public.profiles_private where user_id = p_user_id for update;
  if v_attempts is null then
    return false;
  end if;

  if p_ok then
    if v_locked_until is not null and v_locked_until > now() then
      -- A correct code during a lock still does not open the door.
      return true;
    end if;
    update public.profiles_private
       set recovery_failed_attempts = 0, recovery_locked_until = null
     where user_id = p_user_id;
    update public.recovery_codes set used_at = now()
     where user_id = p_user_id and used_at is null;
    return false;
  end if;

  -- Failure. A lock that has expired starts a fresh count.
  if v_locked_until is not null and v_locked_until <= now() then
    v_attempts := 0;
  end if;
  v_attempts := v_attempts + 1;
  if v_attempts >= 5 then
    update public.profiles_private
       set recovery_failed_attempts = v_attempts, recovery_locked_until = now() + interval '1 hour'
     where user_id = p_user_id;
    return true;
  end if;
  update public.profiles_private
     set recovery_failed_attempts = v_attempts
   where user_id = p_user_id;
  return false;
end;
$$;
revoke all on function private.record_recovery_result(uuid, boolean) from public, anon, authenticated;
grant execute on function private.record_recovery_result(uuid, boolean) to service_role;

-- Per-IP throttle: at most 5 recovery attempts per hour per hashed IP, on
-- top of the per-username lock, so a guesser cannot lock other people out
-- without also locking themselves.
create table public.recovery_attempts (
  id            bigint generated always as identity primary key,
  ip_hash       text not null,
  attempted_at  timestamptz not null default now()
);
comment on table public.recovery_attempts is 'Hashed IPs of recovery attempts for the per-IP throttle. Pruned after an hour.';
create index recovery_attempts_ip_idx on public.recovery_attempts (ip_hash, attempted_at desc);
select private.lock_down('public.recovery_attempts');

-- Records an attempt and says whether it was allowed to proceed.
create or replace function private.recovery_ip_allowed(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  delete from public.recovery_attempts where attempted_at < now() - interval '2 hours';
  select count(*) into v_recent
    from public.recovery_attempts
   where ip_hash = p_ip_hash and attempted_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return false;
  end if;
  insert into public.recovery_attempts (ip_hash) values (p_ip_hash);
  return true;
end;
$$;
revoke all on function private.recovery_ip_allowed(text) from public, anon, authenticated;
grant execute on function private.recovery_ip_allowed(text) to service_role;
