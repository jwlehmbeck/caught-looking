-- U6: badges, hit rate and leaderboards.
--
-- The rules mirror supabase/functions/_shared/domain/badges.ts and
-- leaderboard.ts. Change one, change the other.
--
-- Badges are computed as a TARGET STATE from the user's whole history of
-- scored picks, never as events. evaluate_badges_for_user raises counts and
-- inserts rows; revoke_invalid_badges lowers counts and removes rows whose
-- rule no longer holds. Both are idempotent, so a score correction simply
-- runs both.

-- ---------------------------------------------------------------------------
-- Badge counts the user should hold
-- ---------------------------------------------------------------------------

-- Longest run of consecutive GAME DAYS (official dates with counted, scored
-- games, lifetime) on which the user has a scored pick. Off days and the
-- All-Star break are not game days and so never break a run.
create or replace function private.longest_game_day_run(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  with game_days as (
    select d, row_number() over (order by d) as rn
      from (
        select distinct official_date as d
          from public.games
         where app_state = 'scored' and counts_for_picks
      ) x
  ),
  picked as (
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
     )
  ),
  islands as (
    select rn - row_number() over (order by rn) as grp from picked
  )
  select coalesce(max(cnt), 0)::integer
    from (select count(*) as cnt from islands group by grp) runs;
$$;
revoke all on function private.longest_game_day_run(uuid) from public, anon, authenticated;

create or replace function private.badge_counts(p_user_id uuid)
returns table (badge_slug text, times_earned integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v_run integer := 0;
  v_hot integer := 0;
  v_scored integer := 0;
  v_wrong integer := 0;
  v_upset integer := 0;
  v_perfect integer := 0;
  v_ace boolean := false;
  v_iron boolean := false;
begin
  -- Pick streaks in game-end order; every 5th consecutive correct pick is
  -- one Hot Streak. Upset Special is counted on the same pass.
  for r in
    select p.status,
           (case when p.team_id = g.home_team_id then 'home' else 'away' end) as side,
           g.lock_split
      from public.picks p
      join public.games g on g.id = p.game_id
     where p.user_id = p_user_id
       and p.status in ('correct', 'wrong')
       and g.app_state = 'scored'
       and g.counts_for_picks
     order by g.ended_at, g.id
  loop
    v_scored := v_scored + 1;
    if r.status = 'correct' then
      v_run := v_run + 1;
      if v_run % 5 = 0 then
        v_hot := v_hot + 1;
      end if;
      if r.lock_split is not null
         and coalesce((r.lock_split ->> 'total')::integer, 0) >= 20
         and coalesce((r.lock_split ->> r.side)::numeric, 0)
             / (r.lock_split ->> 'total')::numeric < 0.30 then
        v_upset := v_upset + 1;
      end if;
    else
      v_run := 0;
      v_wrong := v_wrong + 1;
    end if;
  end loop;

  -- Perfect Game: a date with 5+ counted scored games, all picked, all right.
  select count(*)::integer into v_perfect
    from (
      select g.official_date,
             count(*) as games,
             count(p.id) filter (where p.status in ('correct', 'wrong')) as picked,
             count(p.id) filter (where p.status = 'correct') as correct
        from public.games g
        left join public.picks p on p.game_id = g.id and p.user_id = p_user_id
       where g.app_state = 'scored' and g.counts_for_picks
       group by g.official_date
      having count(*) >= 5
         and count(p.id) filter (where p.status in ('correct', 'wrong')) = count(*)
         and count(p.id) filter (where p.status = 'correct') = count(*)
    ) d;

  -- Ace: 70%+ over 50+ scored picks in one season (not lifetime).
  select exists (
    select 1 from public.user_stats s
     where s.user_id = p_user_id and s.season <> 0
       and s.picks_scored >= 50
       and s.picks_correct::numeric / s.picks_scored >= 0.70
  ) into v_ace;

  -- Iron Man: 30 consecutive game days with a pick.
  v_iron := private.longest_game_day_run(p_user_id) >= 30;

  return query
    select * from (values
      ('rookie_card',    case when v_scored > 0 then 1 else 0 end),
      ('caught_looking', case when v_wrong > 0 then 1 else 0 end),
      ('hot_streak',     v_hot),
      ('upset_special',  v_upset),
      ('perfect_game',   v_perfect),
      ('iron_man',       case when v_iron then 1 else 0 end),
      ('ace',            case when v_ace then 1 else 0 end)
    ) as t(slug, n);
end;
$$;
revoke all on function private.badge_counts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Award and revoke
-- ---------------------------------------------------------------------------

-- Raises counts and inserts rows. Never lowers anything; never runs for a
-- void (void_game does not call after_game_scored). p_game_id is recorded
-- as last_game_id on every badge that moved.
create or replace function private.evaluate_badges_for_user(p_user_id uuid, p_game_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_changed integer := 0;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_user_id is null then
    return 0;
  end if;

  for r in
    select c.badge_slug, c.times_earned as want, ub.times_earned as have
      from private.badge_counts(p_user_id) c
      left join public.user_badges ub on ub.user_id = p_user_id and ub.badge_slug = c.badge_slug
     where c.times_earned > coalesce(ub.times_earned, 0)
  loop
    insert into public.user_badges (user_id, badge_slug, times_earned, first_earned, last_earned, last_game_id)
    values (p_user_id, r.badge_slug, r.want, now(), now(), p_game_id)
    on conflict (user_id, badge_slug) do update
      set times_earned = excluded.times_earned,
          last_earned = now(),
          last_game_id = excluded.last_game_id;
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;
revoke all on function private.evaluate_badges_for_user(uuid, bigint) from public, anon, authenticated;
grant execute on function private.evaluate_badges_for_user(uuid, bigint) to service_role;

-- Lowers repeatable counts to what the history supports and removes any
-- badge whose rule no longer holds (Ace when the rate drops, Iron Man when a
-- void breaks the run, Rookie Card with no scored picks, Caught Looking with
-- no wrong picks). Idempotent.
create or replace function private.revoke_invalid_badges(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_changed integer := 0;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_user_id is null then
    return 0;
  end if;

  for r in
    select ub.badge_slug, ub.times_earned as have, coalesce(c.times_earned, 0) as want
      from public.user_badges ub
      left join private.badge_counts(p_user_id) c on c.badge_slug = ub.badge_slug
     where ub.user_id = p_user_id
       and coalesce(c.times_earned, 0) < ub.times_earned
  loop
    if r.want <= 0 then
      delete from public.user_badges where user_id = p_user_id and badge_slug = r.badge_slug;
    else
      update public.user_badges
         set times_earned = r.want
       where user_id = p_user_id and badge_slug = r.badge_slug;
    end if;
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;
revoke all on function private.revoke_invalid_badges(uuid) from public, anon, authenticated;
grant execute on function private.revoke_invalid_badges(uuid) to service_role;

-- Replaces the U5 stub: every user with a pick on the game is reconciled.
create or replace function private.after_game_scored(p_game_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  for v_uid in
    select distinct user_id from public.picks where game_id = p_game_id and user_id is not null
  loop
    perform private.revoke_invalid_badges(v_uid);
    perform private.evaluate_badges_for_user(v_uid, p_game_id);
  end loop;
end;
$$;
revoke all on function private.after_game_scored(bigint) from public, anon, authenticated;
grant execute on function private.after_game_scored(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Leaderboards (materialized; mat views cannot carry RLS so they live in
-- private and are read through the RPCs below)
-- ---------------------------------------------------------------------------

create materialized view private.season_leaderboard as
with qualified as (
  select s.season, s.user_id, p.username, p.favorite_team_id,
         s.picks_scored, s.picks_correct,
         round(s.picks_correct::numeric / s.picks_scored, 4) as hit_rate
    from public.user_stats s
    join public.profiles p on p.id = s.user_id
   where s.season <> 0
     and s.picks_scored >= 25
     and p.status = 'active'
     and p.created_at <= now() - interval '3 days'
     and not private.is_sanctioned(s.user_id, array['ban'])
)
select season, user_id, username, favorite_team_id, picks_scored, picks_correct, hit_rate,
       rank() over (partition by season order by hit_rate desc, picks_correct desc)::integer as rank,
       (count(*) over (partition by season, hit_rate, picks_correct)) > 1 as tied
  from qualified
with data;
create unique index season_leaderboard_pk on private.season_leaderboard (season, user_id);
create index season_leaderboard_rank_idx on private.season_leaderboard (season, rank);
revoke all on private.season_leaderboard from public, anon, authenticated;

create materialized view private.fanbase_leaderboard as
with qualified as (
  select s.season, s.user_id, p.favorite_team_id, s.picks_scored, s.picks_correct
    from public.user_stats s
    join public.profiles p on p.id = s.user_id
   where s.season <> 0
     and s.picks_scored >= 25
     and p.status = 'active'
     and p.favorite_team_id is not null
     and p.created_at <= now() - interval '3 days'
     and not private.is_sanctioned(s.user_id, array['ban'])
),
pooled as (
  select season, favorite_team_id as team_id,
         count(*)::integer as qualified_users,
         sum(picks_scored)::integer as picks_scored,
         sum(picks_correct)::integer as picks_correct
    from qualified
   group by season, favorite_team_id
  having count(*) >= 5
)
select season, team_id, qualified_users, picks_scored, picks_correct,
       round(picks_correct::numeric / picks_scored, 4) as hit_rate,
       rank() over (partition by season order by picks_correct::numeric / picks_scored desc, picks_correct desc)::integer as rank,
       (count(*) over (partition by season, round(picks_correct::numeric / picks_scored, 4), picks_correct)) > 1 as tied
  from pooled
with data;
create unique index fanbase_leaderboard_pk on private.fanbase_leaderboard (season, team_id);
revoke all on private.fanbase_leaderboard from public, anon, authenticated;

create or replace function private.refresh_leaderboards()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  refresh materialized view concurrently private.season_leaderboard;
  refresh materialized view concurrently private.fanbase_leaderboard;
end;
$$;
revoke all on function private.refresh_leaderboards() from public, anon, authenticated;
grant execute on function private.refresh_leaderboards() to service_role;

-- Called once by score-games after its loop (not per game).
create or replace function public.scorer_refresh_leaderboards()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform private.refresh_leaderboards();
end;
$$;
revoke all on function public.scorer_refresh_leaderboards() from public, anon, authenticated;
grant execute on function public.scorer_refresh_leaderboards() to service_role;

-- ---------------------------------------------------------------------------
-- Member RPCs
-- ---------------------------------------------------------------------------

-- app_settings is not readable by clients; this exposes just the season.
create or replace function public.current_season()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::smallint from public.app_settings where key = 'current_season'),
                  extract(year from now())::smallint);
$$;
revoke all on function public.current_season() from public, anon;
grant execute on function public.current_season() to authenticated;

create or replace function public.season_leaderboard(
  p_season smallint default null, p_limit integer default 50, p_offset integer default 0
)
returns table (
  rank integer,
  tied boolean,
  user_id uuid,
  username text,
  favorite_team_id smallint,
  team_abbreviation text,
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
  v_season smallint := coalesce(p_season, public.current_season());
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
    select l.rank, l.tied, l.user_id, l.username, l.favorite_team_id, t.abbreviation,
           l.picks_scored, l.picks_correct, l.hit_rate
      from private.season_leaderboard l
      join public.profiles p on p.id = l.user_id and p.status = 'active'
      left join public.teams t on t.id = l.favorite_team_id
     where l.season = v_season
       and not private.is_sanctioned(l.user_id, array['ban'])
     order by l.rank, l.username
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.season_leaderboard(smallint, integer, integer) from public, anon;
grant execute on function public.season_leaderboard(smallint, integer, integer) to authenticated;

create or replace function public.fanbase_leaderboard(p_season smallint default null)
returns table (
  rank integer,
  tied boolean,
  team_id smallint,
  team_abbreviation text,
  team_name text,
  qualified_users integer,
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
  v_season smallint := coalesce(p_season, public.current_season());
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
    select l.rank, l.tied, l.team_id, t.abbreviation, t.name,
           l.qualified_users, l.picks_scored, l.picks_correct, l.hit_rate
      from private.fanbase_leaderboard l
      join public.teams t on t.id = l.team_id
     where l.season = v_season
     order by l.rank, t.abbreviation;
end;
$$;
revoke all on function public.fanbase_leaderboard(smallint) from public, anon;
grant execute on function public.fanbase_leaderboard(smallint) to authenticated;

-- The viewer's own standing: rank (null when not ranked), how many more
-- scored picks and account days they need, and their season totals.
create or replace function public.my_rank(p_season smallint default null)
returns table (
  season smallint,
  rank integer,
  tied boolean,
  picks_scored integer,
  picks_correct integer,
  picks_needed integer,
  days_needed integer,
  qualified boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_season smallint := coalesce(p_season, public.current_season());
  v_scored integer := 0;
  v_correct integer := 0;
  v_rank integer;
  v_tied boolean;
  v_age_days integer := 0;
begin
  if v_uid is null then
    return;
  end if;
  select s.picks_scored, s.picks_correct into v_scored, v_correct
    from public.user_stats s where s.user_id = v_uid and s.season = v_season;
  v_scored := coalesce(v_scored, 0);
  v_correct := coalesce(v_correct, 0);
  select floor(extract(epoch from now() - p.created_at) / 86400)::integer into v_age_days
    from public.profiles p where p.id = v_uid;
  v_age_days := coalesce(v_age_days, 0);
  select l.rank, l.tied into v_rank, v_tied
    from private.season_leaderboard l where l.season = v_season and l.user_id = v_uid;

  return query
    select v_season, v_rank, coalesce(v_tied, false), v_scored, v_correct,
           greatest(0, 25 - v_scored), greatest(0, 3 - v_age_days),
           (v_scored >= 25 and v_age_days >= 3);
end;
$$;
revoke all on function public.my_rank(smallint) from public, anon;
grant execute on function public.my_rank(smallint) to authenticated;

-- A public profile with season and lifetime stats and the full badge list
-- (locked ones included). Null for deleted profiles and for people the
-- viewer has blocked. Looks up by id or by username.
create or replace function public.profile_overview(p_user_id uuid default null, p_username text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_season smallint := public.current_season();
  p public.profiles%rowtype;
  v_team jsonb;
  v_season_stats jsonb;
  v_life_stats jsonb;
  v_badges jsonb;
  v_rank integer;
  v_tied boolean;
begin
  if v_viewer is null then
    return null;
  end if;

  if p_user_id is not null then
    select * into p from public.profiles where id = p_user_id;
  elsif p_username is not null then
    select * into p from public.profiles where normalized_username = lower(p_username);
  end if;
  if p.id is null or p.status <> 'active' then
    return null;
  end if;
  if p.id <> v_viewer and private.is_blocked_by_viewer(p.id) then
    return null;
  end if;

  select jsonb_build_object('id', t.id, 'abbreviation', t.abbreviation, 'name', t.name, 'city', t.city)
    into v_team from public.teams t where t.id = p.favorite_team_id;

  select jsonb_build_object(
           'picks_scored', s.picks_scored, 'picks_correct', s.picks_correct,
           'current_streak', s.current_streak, 'best_streak', s.best_streak,
           'game_day_streak', s.game_day_streak)
    into v_season_stats
    from public.user_stats s where s.user_id = p.id and s.season = v_season;
  select jsonb_build_object(
           'picks_scored', s.picks_scored, 'picks_correct', s.picks_correct,
           'current_streak', s.current_streak, 'best_streak', s.best_streak,
           'game_day_streak', s.game_day_streak)
    into v_life_stats
    from public.user_stats s where s.user_id = p.id and s.season = 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', b.slug, 'name', b.name, 'description', b.description,
           'repeatable', b.repeatable, 'sort_order', b.sort_order,
           'earned', ub.user_id is not null,
           'times_earned', coalesce(ub.times_earned, 0),
           'first_earned', ub.first_earned, 'last_earned', ub.last_earned
         ) order by b.sort_order), '[]'::jsonb)
    into v_badges
    from public.badges b
    left join public.user_badges ub on ub.badge_slug = b.slug and ub.user_id = p.id;

  select l.rank, l.tied into v_rank, v_tied
    from private.season_leaderboard l where l.season = v_season and l.user_id = p.id;

  return jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'created_at', p.created_at,
    'is_self', p.id = v_viewer,
    'team', v_team,
    'season', v_season,
    'season_stats', coalesce(v_season_stats, jsonb_build_object(
      'picks_scored', 0, 'picks_correct', 0, 'current_streak', 0, 'best_streak', 0, 'game_day_streak', 0)),
    'lifetime_stats', coalesce(v_life_stats, jsonb_build_object(
      'picks_scored', 0, 'picks_correct', 0, 'current_streak', 0, 'best_streak', 0, 'game_day_streak', 0)),
    'season_rank', v_rank,
    'season_rank_tied', coalesce(v_tied, false),
    'badges', v_badges
  );
end;
$$;
revoke all on function public.profile_overview(uuid, text) from public, anon;
grant execute on function public.profile_overview(uuid, text) to authenticated;
