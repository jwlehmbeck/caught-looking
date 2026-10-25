-- U5: pick lock snapshot, scoring, stats recompute, void handling, the
-- viewer's pick RPCs, and the score-games cron job.
--
-- The rules mirror supabase/functions/_shared/domain/scoring.ts. Change one,
-- change the other.

-- ---------------------------------------------------------------------------
-- make_pick: a reopened game (void -> open) gets a fresh pick row state.
-- The previous void pick is replaced in place: status back to active and the
-- pick timestamp moves to now (the last pick counts).
-- ---------------------------------------------------------------------------

create or replace function public.make_pick(p_game_id bigint, p_team_id smallint)
returns public.picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pick public.picks;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if private.is_sanctioned(v_uid, array['suspension', 'ban']) then
    raise exception 'your account is suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;

  insert into public.picks (user_id, game_id, team_id)
  values (v_uid, p_game_id, p_team_id)
  on conflict (user_id, game_id) do update
    set team_id = excluded.team_id,
        status = 'active',
        picked_at = now()
  returning * into v_pick;

  return v_pick;
end;
$$;
revoke all on function public.make_pick(bigint, smallint) from public, anon;
grant execute on function public.make_pick(bigint, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- Hash of the final result (idempotency key for the scorer).
-- 32-bit FNV-1a, same bytes as fnv1aHex() in scoring.ts.
-- ---------------------------------------------------------------------------

create or replace function private.fnv1a_hex(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  h bigint := 2166136261;
  b bytea := convert_to(p_text, 'UTF8');
  i integer;
begin
  for i in 0 .. length(b) - 1 loop
    h := ((h # get_byte(b, i)) * 16777619) % 4294967296;
  end loop;
  return lpad(to_hex(h), 8, '0');
end;
$$;

create or replace function private.final_score_hash(
  p_provider text, p_provider_game_id text, p_home_score smallint, p_away_score smallint, p_winner smallint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.fnv1a_hex(
    p_provider || ':' || p_provider_game_id || ':'
    || coalesce(p_away_score::text, '') || '-' || coalesce(p_home_score::text, '')
    || ':' || coalesce(p_winner::text, '')
  );
$$;

-- ---------------------------------------------------------------------------
-- Lock split snapshot and lock sweep
-- ---------------------------------------------------------------------------

create or replace function private.snapshot_lock_split(p_game_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_split jsonb;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'home',  count(*) filter (where p.team_id = g.home_team_id),
           'away',  count(*) filter (where p.team_id = g.away_team_id),
           'total', count(*)
         )
    into v_split
    from public.games g
    left join public.picks p on p.game_id = g.id and p.status <> 'void'
   where g.id = p_game_id
   group by g.id;

  if v_split is null then
    raise exception 'game % does not exist', p_game_id using errcode = 'P0002';
  end if;

  update public.games
     set lock_split = v_split, updated_at = now()
   where id = p_game_id;
  return v_split;
end;
$$;
revoke all on function private.snapshot_lock_split(bigint) from public, anon, authenticated;
grant execute on function private.snapshot_lock_split(bigint) to service_role;

-- Locks every open game whose lock time has passed and snapshots the split.
-- Also fills in the snapshot for games the poller locked between sweeps.
-- Returns the number of games moved to 'locked'.
create or replace function private.lock_games()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_locked integer := 0;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  for v_id in
    update public.games
       set app_state = 'locked', updated_at = now()
     where app_state = 'open' and now() >= lock_at
    returning id
  loop
    perform private.snapshot_lock_split(v_id);
    v_locked := v_locked + 1;
  end loop;

  for v_id in
    select id from public.games
     where lock_split is null
       and app_state in ('locked', 'live', 'suspended', 'final', 'scored')
  loop
    perform private.snapshot_lock_split(v_id);
  end loop;

  return v_locked;
end;
$$;
revoke all on function private.lock_games() from public, anon, authenticated;
grant execute on function private.lock_games() to service_role;

-- ---------------------------------------------------------------------------
-- Stats recompute (from scratch, per user)
-- ---------------------------------------------------------------------------

-- One stats row for a user and a scope (p_season = 0 means lifetime).
-- Pick streaks run in game-end order; the day streak is the trailing run of
-- game days (distinct official dates with scored, counting games) on which
-- the user has a scored pick.
create or replace function private.compute_user_stats(p_user_id uuid, p_season smallint)
returns public.user_stats
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v public.user_stats;
begin
  v.user_id := p_user_id;
  v.season := p_season;
  v.picks_scored := 0;
  v.picks_correct := 0;
  v.current_streak := 0;
  v.best_streak := 0;
  v.game_day_streak := 0;
  v.last_pick_game_date := null;
  v.updated_at := now();

  for r in
    select p.status
      from public.picks p
      join public.games g on g.id = p.game_id
     where p.user_id = p_user_id
       and p.status in ('correct', 'wrong')
       and g.app_state = 'scored'
       and g.counts_for_picks
       and (p_season = 0 or g.season = p_season)
     order by g.ended_at, g.id
  loop
    v.picks_scored := v.picks_scored + 1;
    if r.status = 'correct' then
      v.picks_correct := v.picks_correct + 1;
      v.current_streak := v.current_streak + 1;
      v.best_streak := greatest(v.best_streak, v.current_streak);
    else
      v.current_streak := 0;
    end if;
  end loop;

  with game_days as (
    select d, row_number() over (order by d) as rn
      from (
        select distinct official_date as d
          from public.games
         where app_state = 'scored' and counts_for_picks
           and (p_season = 0 or season = p_season)
      ) x
  ),
  picked_days as (
    select gd.rn
      from game_days gd
     where exists (
       select 1
         from public.picks p
         join public.games g on g.id = p.game_id
        where p.user_id = p_user_id
          and p.status in ('correct', 'wrong')
          and g.app_state = 'scored'
          and g.counts_for_picks
          and g.official_date = gd.d
          and (p_season = 0 or g.season = p_season)
     )
  ),
  tail_run as (
    select rn,
           max(rn) over () - rn as gap,
           row_number() over (order by rn desc) - 1 as idx
      from picked_days
  )
  select count(*) filter (where gap = idx)::integer,
         (select d from game_days where rn = (select max(rn) from picked_days))
    into v.game_day_streak, v.last_pick_game_date
    from tail_run;

  return v;
end;
$$;
revoke all on function private.compute_user_stats(uuid, smallint) from public, anon, authenticated;

create or replace function private.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season smallint;
  v public.user_stats;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_user_id is null then
    return;
  end if;

  delete from public.user_stats where user_id = p_user_id;

  for v_season in
    select distinct g.season
      from public.picks p
      join public.games g on g.id = p.game_id
     where p.user_id = p_user_id
       and p.status in ('correct', 'wrong')
       and g.app_state = 'scored'
       and g.counts_for_picks
    union select 0::smallint
  loop
    v := private.compute_user_stats(p_user_id, v_season);
    insert into public.user_stats
      (user_id, season, picks_scored, picks_correct, current_streak, best_streak,
       game_day_streak, last_pick_game_date, updated_at)
    values
      (v.user_id, v.season, v.picks_scored, v.picks_correct, v.current_streak, v.best_streak,
       v.game_day_streak, v.last_pick_game_date, now());
  end loop;
end;
$$;
revoke all on function private.recompute_user_stats(uuid) from public, anon, authenticated;
grant execute on function private.recompute_user_stats(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Badge hand-off. A stub here; U6 replaces it with badge evaluation.
-- ---------------------------------------------------------------------------

create or replace function private.after_game_scored(p_game_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;
revoke all on function private.after_game_scored(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scoring and voiding
-- ---------------------------------------------------------------------------

-- Scores one final game. Idempotent on final_score_hash: scoring the same
-- result twice is a no-op; a changed result (MLB correction) re-scores every
-- pick and rebuilds the affected users' stats from scratch. Runs inside the
-- caller's transaction, so a failure leaves nothing half-scored.
-- Returns true when picks were (re)scored, false when nothing changed.
create or replace function private.score_game(p_game_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games%rowtype;
  v_winner smallint;
  v_hash text;
  v_uid uuid;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select * into g from public.games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game % does not exist', p_game_id using errcode = 'P0002';
  end if;
  if g.app_state not in ('final', 'scored') then
    raise exception 'game % is % and cannot be scored', p_game_id, g.app_state using errcode = 'P0001';
  end if;
  if g.home_score is null or g.away_score is null then
    raise exception 'game % is final without both scores', p_game_id using errcode = 'P0001';
  end if;

  v_winner := case
    when g.home_score > g.away_score then g.home_team_id
    when g.away_score > g.home_score then g.away_team_id
  end;
  if v_winner is null then
    -- Tied finals are void games; the poller maps them that way. Refuse.
    raise exception 'game % is final with a tied score', p_game_id using errcode = 'P0001';
  end if;

  v_hash := private.final_score_hash(g.provider, g.provider_game_id, g.home_score, g.away_score, v_winner);
  if g.app_state = 'scored' and g.final_score_hash = v_hash then
    return false;
  end if;

  if g.lock_split is null then
    perform private.snapshot_lock_split(p_game_id);
  end if;

  update public.picks
     set status = case
       when not g.counts_for_picks then 'void'
       when team_id = v_winner then 'correct'
       else 'wrong'
     end
   where game_id = p_game_id;

  update public.games
     set app_state = 'scored',
         winner_team_id = v_winner,
         final_score_hash = v_hash,
         ended_at = coalesce(ended_at, now()),
         updated_at = now()
   where id = p_game_id;

  for v_uid in
    select distinct user_id from public.picks where game_id = p_game_id and user_id is not null
  loop
    perform private.recompute_user_stats(v_uid);
  end loop;

  perform private.after_game_scored(p_game_id);
  return true;
end;
$$;
revoke all on function private.score_game(bigint) from public, anon, authenticated;
grant execute on function private.score_game(bigint) to service_role;

-- Voids every pick on a void game (postponed, cancelled, tied) so none of
-- them count, and rebuilds the affected users' stats. Safe to repeat.
-- Returns the number of picks changed.
create or replace function private.void_game(p_game_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games%rowtype;
  v_uid uuid;
  v_changed integer := 0;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select * into g from public.games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game % does not exist', p_game_id using errcode = 'P0002';
  end if;
  if g.app_state <> 'void' then
    raise exception 'game % is % and cannot be voided', p_game_id, g.app_state using errcode = 'P0001';
  end if;

  for v_uid in
    update public.picks
       set status = 'void'
     where game_id = p_game_id and status <> 'void'
    returning user_id
  loop
    v_changed := v_changed + 1;
    if v_uid is not null then
      perform private.recompute_user_stats(v_uid);
    end if;
  end loop;

  -- A result that was scored and later voided no longer has a result.
  update public.games
     set final_score_hash = null, winner_team_id = null, updated_at = now()
   where id = p_game_id and (final_score_hash is not null or winner_team_id is not null);

  return v_changed;
end;
$$;
revoke all on function private.void_game(bigint) from public, anon, authenticated;
grant execute on function private.void_game(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Scorer entry points. PostgREST only exposes the public schema, so the
-- score-games function reaches the private routines through these thin,
-- service-only wrappers.
-- ---------------------------------------------------------------------------

create or replace function public.scorer_lock_games()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return private.lock_games();
end;
$$;
revoke all on function public.scorer_lock_games() from public, anon, authenticated;
grant execute on function public.scorer_lock_games() to service_role;

-- Games the scorer should look at: finals waiting to be scored, recently
-- scored games (score_game decides whether a correction changed anything)
-- and void games that still carry non-void picks.
create or replace function public.scorer_pending_games(p_days integer default 3)
returns table (game_id bigint, app_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return query
    select g.id, g.app_state
      from public.games g
     where (g.app_state = 'final')
        or (g.app_state = 'scored' and g.official_date >= (now() at time zone 'America/New_York')::date - p_days)
        or (g.app_state = 'void' and exists (
              select 1 from public.picks p where p.game_id = g.id and p.status <> 'void'))
     order by g.ended_at nulls first, g.id;
end;
$$;
revoke all on function public.scorer_pending_games(integer) from public, anon, authenticated;
grant execute on function public.scorer_pending_games(integer) to service_role;

create or replace function public.scorer_score_game(p_game_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return private.score_game(p_game_id);
end;
$$;
revoke all on function public.scorer_score_game(bigint) from public, anon, authenticated;
grant execute on function public.scorer_score_game(bigint) to service_role;

create or replace function public.scorer_void_game(p_game_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return private.void_game(p_game_id);
end;
$$;
revoke all on function public.scorer_void_game(bigint) from public, anon, authenticated;
grant execute on function public.scorer_void_game(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Viewer RPCs
-- ---------------------------------------------------------------------------

-- The viewer's picks between two official dates (inclusive), with the game.
create or replace function public.my_picks(p_from date, p_to date)
returns table (
  pick_id bigint,
  game_id bigint,
  team_id smallint,
  status text,
  picked_at timestamptz,
  official_date date,
  game_date timestamptz,
  lock_at timestamptz,
  app_state text,
  home_team_id smallint,
  away_team_id smallint,
  home_score smallint,
  away_score smallint,
  winner_team_id smallint,
  counts_for_picks boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.game_id, p.team_id, p.status, p.picked_at,
         g.official_date, g.game_date, g.lock_at, g.app_state,
         g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.winner_team_id,
         g.counts_for_picks
    from public.picks p
    join public.games g on g.id = p.game_id
   where p.user_id = (select auth.uid())
     and g.official_date between p_from and p_to
   order by g.game_date, g.id;
$$;
revoke all on function public.my_picks(date, date) from public, anon;
grant execute on function public.my_picks(date, date) to authenticated;

-- Picks of the season's best predictors (10+ scored picks) for one game.
-- Hidden until the viewer has picked or the game has locked, like
-- pick_split, so nobody can copy the sharp players.
create or replace function public.game_top_predictors(p_game_id bigint, p_limit integer default 5)
returns table (
  user_id uuid,
  username text,
  team_id smallint,
  picks_scored integer,
  picks_correct integer,
  hit_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  g public.games%rowtype;
begin
  if v_uid is null then
    return;
  end if;
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    return;
  end if;

  if not (
    (g.app_state <> 'open' or now() >= g.lock_at)
    or exists (select 1 from public.picks where game_id = p_game_id and picks.user_id = v_uid)
  ) then
    return;
  end if;

  return query
    select p.user_id, pr.username, p.team_id, s.picks_scored, s.picks_correct,
           round(s.picks_correct::numeric / s.picks_scored, 4)
      from public.picks p
      join public.profiles pr on pr.id = p.user_id and pr.status = 'active'
      join public.user_stats s on s.user_id = p.user_id and s.season = g.season
     where p.game_id = p_game_id
       and p.status <> 'void'
       and s.picks_scored >= 10
       and not private.is_sanctioned(p.user_id, array['ban'])
     order by s.picks_correct::numeric / s.picks_scored desc, s.picks_correct desc, pr.username
     limit greatest(1, least(coalesce(p_limit, 5), 25));
end;
$$;
revoke all on function public.game_top_predictors(bigint, integer) from public, anon;
grant execute on function public.game_top_predictors(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Cron: call score-games every 2 minutes (same guard pattern as poll-games).
--
-- Production needs the Vault secrets score_games_url and
-- internal_function_secret. The block is a no-op where pg_cron, pg_net or
-- vault are missing or the secrets do not exist yet.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping score-games schedule';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net not installed; skipping score-games schedule';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault not installed; skipping score-games schedule';
    return;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''score_games_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret'' limit 1' into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'vault secrets score_games_url / internal_function_secret missing; skipping score-games schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'score-games';
  perform cron.schedule(
    'score-games',
    '1-59/2 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'score_games_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_function_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end;
$$;
