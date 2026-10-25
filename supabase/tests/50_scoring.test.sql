begin;
select plan(37);

-- People -----------------------------------------------------------------
select tests.create_user('score_alice', 14::smallint, 2010::smallint) as alice \gset
select tests.create_user('score_bob', 19::smallint, 2011::smallint) as bob \gset
select tests.create_user('score_carol', 5::smallint, 2009::smallint) as carol \gset

-- The hash matches the TypeScript implementation (FNV-1a test vectors).
select is(private.fnv1a_hex(''), '811c9dc5', 'fnv1a of empty string');
select is(private.fnv1a_hex('a'), 'e40c292c', 'fnv1a of "a"');
select is(private.fnv1a_hex('foobar'), 'bf9cf968', 'fnv1a of "foobar"');

-- ---------------------------------------------------------------------------
-- Lock edge: 1 s before lock_at is accepted, 1 s after is rejected.
-- ---------------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '1 second') as g_before \gset
select tests.create_game(14::smallint, 19::smallint, now() - interval '1 second') as g_after \gset

select tests.authenticate_as(:'alice');
select lives_ok(
  format('select public.make_pick(%s, 14::smallint)', :'g_before'),
  'a pick 1 s before lock_at is accepted'
);
select throws_ok(
  format('select public.make_pick(%s, 14::smallint)', :'g_after'),
  'P0001', 'picks for this game are locked',
  'a pick 1 s after lock_at is rejected even while app_state is still open'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- lock_games moves overdue open games to locked and snapshots the split.
-- ---------------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '1 hour') as g_main \gset

select tests.authenticate_as(:'alice');
select lives_ok(format('select public.make_pick(%s, 14::smallint)', :'g_main'), 'alice picks LAD');
select tests.authenticate_as(:'bob');
select lives_ok(format('select public.make_pick(%s, 19::smallint)', :'g_main'), 'bob picks NYY');
select tests.authenticate_as(:'carol');
select lives_ok(format('select public.make_pick(%s, 14::smallint)', :'g_main'), 'carol picks LAD');
select tests.clear_authentication();

-- Members cannot call the service routines.
select tests.authenticate_as(:'alice');
select throws_ok(
  $$ select private.lock_games() $$, '42501', null, 'a member cannot call lock_games'
);
select throws_ok(
  format('select private.score_game(%s)', :'g_main'), '42501', null, 'a member cannot call score_game'
);
select tests.clear_authentication();

-- Move the lock into the past, then sweep as the service role.
update public.games set lock_at = now() - interval '1 second' where id = :'g_main';

select tests.authenticate_as_service();
select is(public.scorer_lock_games(), 2, 'lock_games locks the two overdue open games (g_main and g_after)');
select tests.clear_authentication();

select is((select app_state from public.games where id = :'g_main'), 'locked', 'the game is locked');
select is(
  (select lock_split from public.games where id = :'g_main'),
  '{"home": 2, "away": 1, "total": 3}'::jsonb,
  'the split was snapshotted at lock'
);

-- ---------------------------------------------------------------------------
-- score_game marks picks and updates user_stats.
-- ---------------------------------------------------------------------------
update public.games
   set app_state = 'final', home_score = 4, away_score = 2
 where id = :'g_main';

select tests.authenticate_as_service();
select is(private.score_game(:'g_main'), true, 'score_game scores a final game');
select tests.clear_authentication();

select is((select app_state from public.games where id = :'g_main'), 'scored', 'game is scored');
select is((select winner_team_id from public.games where id = :'g_main'), 14::smallint, 'LAD recorded as winner');
select isnt((select ended_at from public.games where id = :'g_main'), null, 'ended_at is recorded');
select isnt((select final_score_hash from public.games where id = :'g_main'), null, 'final_score_hash is recorded');
select is((select status from public.picks where game_id = :'g_main' and user_id = :'alice'), 'correct', 'alice called it');
select is((select status from public.picks where game_id = :'g_main' and user_id = :'bob'), 'wrong', 'bob was caught looking');

select is(
  (select row(picks_scored, picks_correct, current_streak, best_streak, game_day_streak)::text
     from public.user_stats where user_id = :'alice' and season = 2027),
  '(1,1,1,1,1)', 'alice season stats'
);
select is(
  (select row(picks_scored, picks_correct, current_streak, best_streak)::text
     from public.user_stats where user_id = :'alice' and season = 0),
  '(1,1,1,1)', 'alice lifetime stats'
);
select is(
  (select row(picks_scored, picks_correct, current_streak, best_streak)::text
     from public.user_stats where user_id = :'bob' and season = 0),
  '(1,0,0,0)', 'bob lifetime stats'
);

-- Running the scorer again changes nothing.
select (select final_score_hash from public.games where id = :'g_main') as hash1 \gset
select (select updated_at from public.picks where game_id = :'g_main' and user_id = :'alice') as alice_pick_updated \gset

select tests.authenticate_as_service();
select is(private.score_game(:'g_main'), false, 'scoring the same final twice is a no-op');
select tests.clear_authentication();

select is((select final_score_hash from public.games where id = :'g_main'), :'hash1', 'hash unchanged on repeat');
select is(
  (select updated_at from public.picks where game_id = :'g_main' and user_id = :'alice'),
  :'alice_pick_updated'::timestamptz,
  'picks were not touched by the repeat run'
);

-- ---------------------------------------------------------------------------
-- A score correction that flips the winner re-scores picks and stats.
-- ---------------------------------------------------------------------------
update public.games set home_score = 2, away_score = 5 where id = :'g_main';

select tests.authenticate_as_service();
select is(private.score_game(:'g_main'), true, 'a corrected score re-scores the game');
select tests.clear_authentication();

select isnt((select final_score_hash from public.games where id = :'g_main'), :'hash1', 'hash changed with the correction');
select is((select status from public.picks where game_id = :'g_main' and user_id = :'alice'), 'wrong', 'alice is now wrong');
select is((select status from public.picks where game_id = :'g_main' and user_id = :'bob'), 'correct', 'bob is now correct');
select is(
  (select row(picks_scored, picks_correct, current_streak, best_streak)::text
     from public.user_stats where user_id = :'bob' and season = 0),
  '(1,1,1,1)', 'bob lifetime stats after correction'
);
select is(
  (select row(picks_scored, picks_correct, current_streak, best_streak)::text
     from public.user_stats where user_id = :'alice' and season = 0),
  '(1,0,0,0)', 'alice lifetime stats after correction'
);

-- ---------------------------------------------------------------------------
-- A voided game: picks become void and do not count.
-- ---------------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '1 hour') as g_void \gset
select tests.authenticate_as(:'alice');
select public.make_pick(:'g_void', 14::smallint);
select tests.clear_authentication();

update public.games set app_state = 'void' where id = :'g_void';

select tests.authenticate_as_service();
select is(private.void_game(:'g_void'), 1, 'void_game voids the one pick');
select tests.clear_authentication();

select is((select status from public.picks where game_id = :'g_void' and user_id = :'alice'), 'void', 'the pick is void');
select is(
  (select picks_scored from public.user_stats where user_id = :'alice' and season = 0),
  1, 'a void pick is not counted'
);

-- ---------------------------------------------------------------------------
-- Top predictors are hidden until the viewer has picked.
-- ---------------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '1 hour') as g_top \gset
-- Give alice a qualifying season record so she would appear.
insert into public.user_stats (user_id, season, picks_scored, picks_correct)
values (:'alice', 2027, 12, 9)
on conflict (user_id, season) do update set picks_scored = 12, picks_correct = 9;
select tests.authenticate_as(:'alice');
select public.make_pick(:'g_top', 14::smallint);

select tests.authenticate_as(:'bob');
select is((select count(*) from public.game_top_predictors(:'g_top', 5)), 0::bigint,
  'top predictors hidden before bob picks');
select public.make_pick(:'g_top', 19::smallint);
select is((select username from public.game_top_predictors(:'g_top', 5) limit 1), 'score_alice',
  'top predictors visible right after bob picks');
select tests.clear_authentication();

select * from finish();
rollback;
