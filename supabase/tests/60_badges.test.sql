begin;
select plan(33);

-- People -----------------------------------------------------------------
-- Accounts are backdated so the 3-day leaderboard minimum is met where the
-- test wants it; "newbie" stays brand new.
select tests.create_user('b_alice', 14::smallint, 2010::smallint) as alice \gset
select tests.create_user('b_bob', 19::smallint, 2011::smallint) as bob \gset
select tests.create_user('b_banned', 19::smallint, 2011::smallint) as banned \gset
select tests.create_user('b_newbie', 14::smallint, 2011::smallint) as newbie \gset
update public.profiles set created_at = now() - interval '10 days'
 where id in (:'alice', :'bob', :'banned');

-- Twenty extra pickers so one game can clear the Upset Special threshold.
do $$
declare i integer;
begin
  for i in 1..20 loop
    perform tests.create_user('b_crowd_' || i, 19::smallint, 2010::smallint);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Game 1: a 24-picker upset. Alice alone takes LAD (home); the crowd and
-- bob take NYY. LAD wins.
-- ---------------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '1 hour') as g1 \gset
select tests.authenticate_as(:'alice');
select public.make_pick(:'g1', 14::smallint);
select tests.authenticate_as(:'bob');
select public.make_pick(:'g1', 19::smallint);
select tests.authenticate_as(:'banned');
select public.make_pick(:'g1', 19::smallint);
select tests.clear_authentication();
do $$
declare u uuid; g bigint;
begin
  select id into g from public.games where provider_game_id like 'test-%' order by id desc limit 1;
  for u in select id from public.profiles where username like 'b_crowd_%' loop
    perform tests.authenticate_as(u);
    perform public.make_pick(g, 19::smallint);
    perform tests.clear_authentication();
  end loop;
end $$;

update public.games set lock_at = now() - interval '1 second' where id = :'g1';
select tests.authenticate_as_service();
select public.scorer_lock_games();
select tests.clear_authentication();
select is((select lock_split from public.games where id = :'g1'),
  '{"home": 1, "away": 22, "total": 23}'::jsonb, 'the split at lock has 23 pickers');

update public.games set app_state = 'final', home_score = 3, away_score = 1,
       ended_at = now() - interval '9 days', official_date = (now() - interval '9 days')::date
 where id = :'g1';
select tests.authenticate_as_service();
select is(private.score_game(:'g1'), true, 'game 1 scored');
select tests.clear_authentication();

select is((select times_earned from public.user_badges where user_id = :'alice' and badge_slug = 'rookie_card'),
  1, 'alice: Rookie Card on her first scored pick');
select is((select times_earned from public.user_badges where user_id = :'alice' and badge_slug = 'upset_special'),
  1, 'alice: Upset Special (1 of 23 took LAD)');
select ok(not exists (select 1 from public.user_badges where user_id = :'alice' and badge_slug = 'caught_looking'),
  'alice: no Caught Looking yet');
select is((select times_earned from public.user_badges where user_id = :'bob' and badge_slug = 'caught_looking'),
  1, 'bob: Caught Looking on his first wrong pick');
select is((select times_earned from public.user_badges where user_id = :'bob' and badge_slug = 'rookie_card'),
  1, 'bob: Rookie Card too');
select is((select last_game_id from public.user_badges where user_id = :'alice' and badge_slug = 'upset_special'),
  :'g1'::bigint, 'last_game_id records the awarding game');

-- Members cannot call the badge routines directly.
select tests.authenticate_as(:'alice');
select throws_ok(format('select private.evaluate_badges_for_user(%L, %s)', :'alice', :'g1'), '42501', null,
  'a member cannot evaluate badges');
select throws_ok(format('select private.revoke_invalid_badges(%L)', :'alice'), '42501', null,
  'a member cannot revoke badges');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- Games 2-6: alice goes 4 more correct (5 in a row) with a void in between.
-- Bob picks the opposite side every time. These are 2-pickers, so no upset.
-- ---------------------------------------------------------------------------
do $$
declare
  i integer; g bigint; a uuid; b uuid;
begin
  select id into a from public.profiles where username = 'b_alice';
  select id into b from public.profiles where username = 'b_bob';
  for i in 1..5 loop
    g := tests.create_game(14::smallint, 19::smallint, now() + interval '1 hour');
    perform tests.authenticate_as(a);
    perform public.make_pick(g, 14::smallint);
    perform tests.authenticate_as(b);
    perform public.make_pick(g, 19::smallint);
    perform tests.clear_authentication();
    if i = 3 then
      -- Game 4 is postponed: void, skipped by streaks.
      update public.games set app_state = 'void', lock_at = now() - interval '1 second' where id = g;
      perform tests.authenticate_as_service();
      perform private.void_game(g);
      perform tests.clear_authentication();
    else
      update public.games
         set app_state = 'final', home_score = 5, away_score = 2, lock_at = now() - interval '1 second',
             ended_at = now() - (8 - i) * interval '1 day',
             official_date = (now() - (8 - i) * interval '1 day')::date
       where id = g;
      perform tests.authenticate_as_service();
      perform private.score_game(g);
      perform tests.clear_authentication();
    end if;
  end loop;
end $$;

select is((select picks_scored from public.user_stats where user_id = :'alice' and season = 0),
  5, 'alice has 5 scored picks (the void does not count)');
select is((select times_earned from public.user_badges where user_id = :'alice' and badge_slug = 'hot_streak'),
  1, 'alice: Hot Streak at 5 in a row, void skipped');
select is((select times_earned from public.user_badges where user_id = :'alice' and badge_slug = 'upset_special'),
  1, 'alice: still one Upset Special (2-picker games do not qualify)');
select ok(not exists (select 1 from public.user_badges where user_id = :'bob' and badge_slug = 'hot_streak'),
  'bob: no Hot Streak');

-- ---------------------------------------------------------------------------
-- Correction: game 1 flips to NYY. Alice loses the upset and the streak
-- (4 in a row now), gains Caught Looking. Bob's Caught Looking stays: his
-- other picks are still wrong.
-- ---------------------------------------------------------------------------
update public.games set home_score = 1, away_score = 4 where id = :'g1';
select tests.authenticate_as_service();
select is(private.score_game(:'g1'), true, 'game 1 re-scored after the correction');
select tests.clear_authentication();

select ok(not exists (select 1 from public.user_badges where user_id = :'alice' and badge_slug = 'upset_special'),
  'alice: Upset Special revoked when the pick turned wrong');
select ok(not exists (select 1 from public.user_badges where user_id = :'alice' and badge_slug = 'hot_streak'),
  'alice: Hot Streak revoked (only 4 in a row remain)');
select is((select times_earned from public.user_badges where user_id = :'alice' and badge_slug = 'caught_looking'),
  1, 'alice: Caught Looking after her first wrong pick');
select is((select times_earned from public.user_badges where user_id = :'bob' and badge_slug = 'caught_looking'),
  1, 'bob: Caught Looking kept (still has wrong picks)');
select ok(not exists (select 1 from public.user_badges where user_id = :'bob' and badge_slug = 'upset_special'),
  'bob: no Upset Special (he was with 22 of 23)');

-- ---------------------------------------------------------------------------
-- Ace: granted at 70%+ over 50, revoked when the rate drops.
-- ---------------------------------------------------------------------------
insert into public.user_stats (user_id, season, picks_scored, picks_correct)
values (:'alice', 2026, 60, 45);
select tests.authenticate_as_service();
select is(private.evaluate_badges_for_user(:'alice', null), 1, 'Ace awarded for a 75% season over 60 picks');
select tests.clear_authentication();
update public.user_stats set picks_correct = 40 where user_id = :'alice' and season = 2026;
select tests.authenticate_as_service();
select is(private.revoke_invalid_badges(:'alice'), 1, 'Ace revoked once the rate falls to 67%');
select tests.clear_authentication();
select ok(not exists (select 1 from public.user_badges where user_id = :'alice' and badge_slug = 'ace'),
  'alice: no Ace row remains');

-- ---------------------------------------------------------------------------
-- Leaderboards: qualification, banned users, my_rank, fan bases
-- ---------------------------------------------------------------------------
-- Season 2027 totals: alice 30/20, bob 30/20 (tie), banned 30/25, newbie 30/29.
insert into public.user_stats (user_id, season, picks_scored, picks_correct) values
  (:'alice', 2027, 30, 20), (:'bob', 2027, 30, 20), (:'banned', 2027, 30, 25), (:'newbie', 2027, 30, 29)
on conflict (user_id, season) do update
  set picks_scored = excluded.picks_scored, picks_correct = excluded.picks_correct;
insert into public.sanctions (user_id, kind, reason) values (:'banned', 'ban', 'test');

select tests.authenticate_as_service();
select lives_ok('select public.scorer_refresh_leaderboards()', 'the service refreshes the leaderboards');
select tests.clear_authentication();

select tests.authenticate_as(:'bob');
select is((select array_agg(username order by username) from public.season_leaderboard(2027::smallint, 50, 0)),
  array['b_alice', 'b_bob'], 'the board lists alice and bob only: the banned user and the 0-day account are out');
select is((select array_agg(rank || ':' || tied::text order by username) from public.season_leaderboard(2027::smallint, 50, 0)),
  array['1:true', '1:true'], 'identical rate and correct share rank 1');
select is((select rank || '/' || tied::text || '/' || picks_needed || '/' || qualified::text from public.my_rank(2027::smallint)),
  '1/true/0/true', 'my_rank reports bob tied at 1');
select is((select count(*) from public.fanbase_leaderboard(2027::smallint)), 0::bigint,
  'no fan base has 5 qualified users yet');
select tests.clear_authentication();

select tests.authenticate_as(:'newbie');
select is((select (rank is null)::text || '/' || picks_needed || '/' || days_needed from public.my_rank(2027::smallint)),
  'true/0/3', 'a new account has no rank and needs 3 more days');
select tests.clear_authentication();

-- 24 vs 25 picks for a 10-day-old account.
update public.user_stats set picks_scored = 24, picks_correct = 20 where user_id = :'alice' and season = 2027;
select tests.authenticate_as_service();
select public.scorer_refresh_leaderboards();
select tests.clear_authentication();
select tests.authenticate_as(:'alice');
select is((select (rank is null)::text || '/' || picks_needed from public.my_rank(2027::smallint)),
  'true/1', 'with 24 picks alice is off the board and needs 1 more');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- profile_overview: full badge list, null for a blocked user
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'bob');
select is((select jsonb_array_length(public.profile_overview(:'alice', null) -> 'badges')), 7,
  'profile_overview lists all seven badges, locked ones included');
select public.block_user(:'alice');
select is(public.profile_overview(:'alice', null), null, 'profile_overview is null for a user the viewer blocked');
select is(public.profile_overview(null, 'B_BOB') ->> 'username', 'b_bob', 'own profile resolves by username');
select tests.clear_authentication();

select * from finish();
rollback;
