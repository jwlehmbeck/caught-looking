begin;
select plan(11);

select tests.create_user('alice') as alice \gset
select tests.create_user('bob') as bob \gset
select tests.create_game(14::smallint, 19::smallint) as game \gset
select tests.create_game(14::smallint, 19::smallint, now() - interval '1 minute', 'locked') as locked_game \gset

-- Alice makes and changes a pick before lock.
select tests.authenticate_as(:'alice');
select is((select (public.make_pick(:'game', 14::smallint)).team_id), 14::smallint, 'alice picks the home team');
select is((select (public.make_pick(:'game', 19::smallint)).team_id), 19::smallint, 'alice changes her pick before lock');
select is((select count(*) from public.picks where user_id = :'alice' and game_id = :'game'), 1::bigint,
  'changing a pick keeps one row per user per game');

-- Direct writes are rejected even for the owner.
select throws_ok(
  $$ insert into public.picks (user_id, game_id, team_id)
     values (current_setting('request.jwt.claim.sub')::uuid, 1, 14) $$,
  '42501', null, 'a member cannot insert a pick directly'
);
select throws_ok(
  $$ update public.picks set status = 'correct' $$,
  '42501', null, 'a member cannot update picks directly'
);

-- Locked game: rejected.
select throws_ok(
  format('select public.make_pick(%s, 14::smallint)', :'locked_game'),
  'P0001', 'picks for this game are locked', 'picking a locked game is rejected'
);

-- A team not in the game: rejected.
select throws_ok(
  format('select public.make_pick(%s, 5::smallint)', :'game'),
  '23514', null, 'picking a team that is not playing is rejected'
);

-- Fan split is hidden until the viewer picks.
select tests.authenticate_as(:'bob');
select is((select count(*) from public.pick_split(:'game')), 0::bigint, 'split is hidden before bob picks');
select is((select count(*) from public.picks where game_id = :'game' and user_id = :'alice'), 0::bigint,
  'bob cannot see alice''s pick before lock');
select lives_ok(format('select public.make_pick(%s, 14::smallint)', :'game'), 'bob picks');
select is((select total from public.pick_split(:'game')), 2, 'split shows both picks once bob has picked');

select * from finish();
rollback;
