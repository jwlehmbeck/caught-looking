begin;
select plan(6);

select tests.create_user('home_alice') as alice \gset
select tests.create_user('home_bob') as bob \gset

select tests.create_game(14::smallint, 19::smallint, now() - interval '1 hour', 'live') as live_a \gset
select tests.create_game(1::smallint, 2::smallint, now() - interval '2 hours', 'live') as live_b \gset
select tests.create_game(3::smallint, 4::smallint, now() + interval '2 hours', 'open') as pre_lock \gset

-- Messages written directly as the owner: the RPC only reads.
insert into public.chat_messages (game_id, author_id, body, status, created_at) values
  (:'live_a', :'bob', 'older', 'live', now() - interval '10 minutes'),
  (:'live_a', :'bob', 'newer', 'live', now() - interval '2 minutes'),
  (:'live_a', :'bob', 'held one', 'held', now() - interval '1 minute'),
  (:'live_b', :'bob', 'only one', 'live', now() - interval '5 minutes'),
  (:'pre_lock', :'alice', 'my own, before lock', 'live', now());

select tests.authenticate_as(:'alice');

select ok(
  (select last_message_at from public.home_chat_activity(array[:'live_a', :'live_b']::bigint[]) where game_id = :'live_a')
    between now() - interval '3 minutes' and now() - interval '1 minute',
  'last live message time per game, ignoring held messages'
);
select is(
  (select count(*)::int from public.home_chat_activity(array[:'live_a', :'live_b']::bigint[])),
  2, 'one row per game with messages'
);
select is(
  (select count(*)::int from public.home_chat_activity(array[:'pre_lock']::bigint[])),
  1, 'own messages follow the read policy (an author can see their own)'
);
select is(
  (select count(*)::int from public.home_chat_activity(null)),
  0, 'null input returns nothing'
);
select tests.clear_authentication();

select tests.authenticate_as(:'bob');
select is(
  (select count(*)::int from public.home_chat_activity(array[:'pre_lock']::bigint[])),
  0, 'other people''s messages in a game that has not locked are not visible'
);
select tests.clear_authentication();

set local role anon;
select throws_ok(
  $$ select * from public.home_chat_activity(array[1]::bigint[]) $$,
  '42501', null, 'anon cannot call home_chat_activity'
);
reset role;

select * from finish();
rollback;
