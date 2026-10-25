-- Helpers for pgTAP tests. They live in their own schema with no client
-- grants, so they are inert in production.

create schema if not exists tests;
-- Tests switch roles mid-file, so the client roles need to reach the
-- role-switching helpers. Data-creating helpers stay postgres-only (below).
grant usage on schema tests to anon, authenticated, service_role;

-- Creates an auth user plus profile and private row; returns the user id.
create or replace function tests.create_user(
  p_username text,
  p_team smallint default 14,
  p_birth_year smallint default 2010
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_id::text || '@users.caughtlooking.invalid', now(), now());
  insert into public.profiles (id, username, normalized_username, favorite_team_id)
  values (v_id, p_username, lower(p_username), p_team);
  insert into public.profiles_private (user_id, birth_year)
  values (v_id, p_birth_year);
  return v_id;
end;
$$;

create or replace function tests.grant_role(p_user_id uuid, p_role text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role;
$$;

-- Switches the session to the authenticated role as this user.
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.authenticate_as_service()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  execute 'reset role';
end;
$$;

-- A game between two teams, open for picks until p_lock_at.
create or replace function tests.create_game(
  p_home smallint, p_away smallint, p_lock_at timestamptz default now() + interval '2 hours',
  p_app_state text default 'open', p_season_type text default 'regular'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.games (provider, provider_game_id, season, season_type, official_date, game_date,
                            lock_at, app_state, home_team_id, away_team_id)
  values ('mlb', 'test-' || gen_random_uuid()::text, 2027, p_season_type, p_lock_at::date, p_lock_at,
          p_lock_at, p_app_state, p_home, p_away)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function tests.create_user(text, smallint, smallint) from public, anon, authenticated, service_role;
revoke all on function tests.grant_role(uuid, text) from public, anon, authenticated, service_role;
revoke all on function tests.create_game(smallint, smallint, timestamptz, text, text) from public, anon, authenticated, service_role;
