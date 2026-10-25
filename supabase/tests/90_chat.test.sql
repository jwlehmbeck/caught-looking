begin;
select plan(24);

-- People -------------------------------------------------------------------
select tests.create_user('chat_alice') as alice \gset
select tests.create_user('chat_bob') as bob \gset
select tests.create_user('chat_newbie') as newbie \gset
select tests.create_user('chat_muted') as muted \gset
select tests.create_user('chat_mod') as mod \gset
select tests.grant_role(:'mod', 'mod');
select tests.create_user('chat_admin', 14::smallint, 1980::smallint) as admin \gset
select tests.grant_role(:'admin', 'admin');

-- Accounts are 24 h old unless the test says otherwise.
update public.profiles set created_at = now() - interval '3 days'
 where id in (:'alice', :'bob', :'muted', :'mod', :'admin');
update public.profiles set created_at = now() - interval '2 hours' where id = :'newbie';

-- Games --------------------------------------------------------------------
select tests.create_game(14::smallint, 19::smallint, now() + interval '2 hours', 'open') as pre_lock \gset
select tests.create_game(14::smallint, 19::smallint, now() - interval '1 hour', 'live') as live \gset
select tests.create_game(14::smallint, 19::smallint, now() - interval '5 hours', 'final') as old_final \gset
update public.games set ended_at = now() - interval '31 minutes' where id = :'old_final';
select tests.create_game(14::smallint, 19::smallint, now() - interval '4 hours', 'final') as fresh_final \gset
update public.games set ended_at = now() - interval '10 minutes' where id = :'fresh_final';

-- Mute one person.
insert into public.sanctions (user_id, kind, reason, ends_at)
values (:'muted', 'chat_mute', 'test mute', now() + interval '1 hour');

-- 1. Window states ----------------------------------------------------------
select tests.authenticate_as(:'alice');
select is((select reason from public.chat_window(:'pre_lock')), 'pre_lock', 'before lock the chat has not opened');
select is((select open from public.chat_window(:'pre_lock')), false, 'pre-lock window is not open');
select is((select reason from public.chat_window(:'live')), 'ok', 'a live game is open to a 3-day-old account');
select is((select can_send from public.chat_window(:'live')), true, 'and that account can send');
select is((select read_only from public.chat_window(:'old_final')), true, '31 minutes after the final the chat is read-only');
select is((select open from public.chat_window(:'fresh_final')), true, '10 minutes after the final the chat is still open');
select is((select slow_mode_seconds from public.chat_window(:'live')), 10, 'default slow mode is 10 seconds');
select tests.clear_authentication();

select tests.authenticate_as(:'newbie');
select is((select reason from public.chat_window(:'live')), 'account_age', 'a 2-hour-old account is told to wait');
select ok((select unlocks_at > now() + interval '21 hours' from public.chat_window(:'live')), 'and is given the unlock time');
select tests.clear_authentication();

select tests.authenticate_as(:'muted');
select is((select reason from public.chat_window(:'live')), 'muted', 'a muted member sees the mute');
select tests.clear_authentication();

-- 2. Members cannot call the write path directly ----------------------------
select tests.authenticate_as(:'alice');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'alice', :'live', 'hello', 'live'),
  '42501', null, 'a member cannot call post_chat_message');
select tests.clear_authentication();

-- 3. The service path enforces every rule -----------------------------------
select tests.authenticate_as_service();
select lives_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'alice', :'live', 'lets go', 'live'),
  'the service can post for a member in a live game');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'alice', :'live', 'again', 'live'),
  'P0429', 'slow mode', 'a second message within 10 seconds is rejected');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'newbie', :'live', 'hi', 'live'),
  '42501', 'account too new', 'a 2-hour-old account cannot send');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'muted', :'live', 'hi', 'live'),
  '42501', 'muted', 'a muted member cannot send');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'bob', :'live', repeat('x', 201), 'live'),
  '22023', null, 'a 201-character message is rejected');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'bob', :'pre_lock', 'early', 'live'),
  'P0001', 'chat has not opened', 'nobody can send before lock');
select throws_ok(format('select public.post_chat_message(%L, %s, %L, %L)', :'bob', :'old_final', 'late', 'live'),
  'P0001', 'chat is closed', 'nobody can send 31 minutes after the final');
select is((select status from public.post_chat_message(:'bob', :'live', 'borderline', 'hidden')),
  'hidden', 'a held message is stored as hidden');
select tests.clear_authentication();

-- 4. History hides blocked authors -------------------------------------------
-- Backdate alice's message so bob's own post is not slowed.
insert into public.chat_messages (game_id, author_id, body, created_at)
values (:'live', :'bob', 'bob was here', now() - interval '5 minutes');
insert into public.blocks (blocker_id, blocked_id) values (:'alice', :'bob');

select tests.authenticate_as(:'alice');
select is((select count(*) from public.chat_history(:'live') where author_id = :'bob'), 0::bigint,
  'history for the blocker excludes the blocked author');
select is((select count(*) from public.chat_history(:'live') where author_id = :'alice'), 1::bigint,
  'and keeps everyone else (hidden messages never appear)');
select tests.clear_authentication();

-- 5. Staff set slow mode ------------------------------------------------------
select tests.authenticate_as(:'mod');
select lives_ok(format('select public.set_chat_slow_mode(%s, 30)', :'live'), 'a mod can set slow mode');
select tests.clear_authentication();
select tests.authenticate_as(:'bob');
select throws_ok(format('select public.set_chat_slow_mode(%s, 60)', :'live'), '42501', null, 'a member cannot set slow mode');
select is((select slow_mode_seconds from public.chat_window(:'live')), 30, 'the new slow mode is reported to members');
select tests.clear_authentication();

select * from finish();
rollback;
