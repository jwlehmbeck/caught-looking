begin;
select plan(24);

-- People -------------------------------------------------------------------
select tests.create_user('alice') as alice \gset
select tests.create_user('bob') as bob \gset
select tests.create_user('sam_suspended') as sam \gset
select tests.create_user('max_mod') as mod \gset
select tests.grant_role(:'mod', 'mod');
select tests.create_game(14::smallint, 19::smallint, now() + interval '2 hours', 'open') as game \gset

insert into public.sanctions (user_id, kind, reason, ends_at)
values (:'sam', 'suspension', 'test', now() + interval '1 day');

-- 1. Only staff create polls --------------------------------------------------
select tests.authenticate_as(:'alice');
select throws_ok(
  format('select public.create_poll(%L, %L, %L, %L)', :'alice', 'Who wins?', array['A', 'B'], now() + interval '1 hour'),
  '42501', null, 'a regular user cannot call create_poll at all');
select tests.clear_authentication();

select tests.authenticate_as_service();
select throws_ok(
  format('select public.create_poll(%L, %L, %L, %L)', :'alice', 'Who wins?', array['A', 'B'], now() + interval '1 hour'),
  '42501', 'only mods and admins can create polls', 'the service path refuses a non-staff author');
select throws_ok(
  format('select public.create_poll(%L, %L, %L, %L)', :'mod', 'Who wins?', array['Only one'], now() + interval '1 hour'),
  '22023', 'a poll needs 2 to 4 options', 'one option is rejected');
select throws_ok(
  format('select public.create_poll(%L, %L, %L, %L)', :'mod', 'Who wins?', array['A', 'B', 'C', 'D', 'E'], now() + interval '1 hour'),
  '22023', 'a poll needs 2 to 4 options', 'five options are rejected');

select public.create_poll(:'mod', 'Better rivalry?', array['Yankees–Red Sox', 'Dodgers–Giants', 'Cubs–Cardinals'],
  now() + interval '1 hour', 14::smallint, 19::smallint, :'game') as poll \gset
select public.create_poll(:'mod', 'Second poll', array['Yes', 'No'], now() + interval '1 hour') as poll2 \gset
select public.create_poll(:'mod', 'Soon to close', array['Yes', 'No'], now() + interval '1 hour') as poll3 \gset
select tests.clear_authentication();

select is((select count(*) from public.poll_options where poll_id = :'poll'), 3::bigint, 'staff created a poll with 3 options');
select is((select count(*) from public.mod_actions where action = 'create_poll' and target_id = :'poll'::text and actor_id = :'mod'),
  1::bigint, 'creation is logged with the staff actor');

select (select id from public.poll_options where poll_id = :'poll' and sort_order = 1) as opt1 \gset
select (select id from public.poll_options where poll_id = :'poll' and sort_order = 2) as opt2 \gset
select (select id from public.poll_options where poll_id = :'poll2' and sort_order = 1) as other_opt \gset

-- 2. Results hidden before voting, visible after -----------------------------
select tests.authenticate_as(:'alice');
select is((select (public.poll_results(:'poll'))->>'results_visible'), 'false', 'results are hidden before voting');
select is((select (public.poll_results(:'poll'))->'options'->0->'count'), 'null'::jsonb, 'counts are null before voting');

select throws_ok(format('select public.vote_poll(%s, %s)', :'poll', :'other_opt'),
  '22023', 'that option is not in this poll', 'an option from another poll is rejected');

select lives_ok(format('select public.vote_poll(%s, %s)', :'poll', :'opt1'), 'alice votes once');
select throws_ok(format('select public.vote_poll(%s, %s)', :'poll', :'opt2'),
  '23505', 'you already voted in this poll', 'a second vote is rejected');

select is((select (public.poll_results(:'poll'))->>'results_visible'), 'true', 'results are visible after voting');
select is((select (public.poll_results(:'poll'))->>'my_option_id'), :'opt1'::text, 'the viewer sees their own option');
select is((select (public.poll_results(:'poll'))->>'total'), '1', 'total matches the vote rows');
select is((select (public.poll_results(:'poll'))->'options'->0->>'count'), '1', 'the voted option counts 1');
select is((select count(*) from public.poll_votes where poll_id = :'poll'), 1::bigint, 'one vote row exists');
select tests.clear_authentication();

-- 3. Suspended users cannot vote ---------------------------------------------
select tests.authenticate_as(:'sam');
select throws_ok(format('select public.vote_poll(%s, %s)', :'poll', :'opt1'),
  '42501', 'your account is suspended', 'a suspended user cannot vote');
select tests.clear_authentication();

-- 4. Closing ------------------------------------------------------------------
select tests.authenticate_as(:'bob');
select throws_ok(format('select public.close_poll(%s)', :'poll'), '42501', null, 'a regular user cannot close a poll');
select tests.clear_authentication();

select tests.authenticate_as(:'mod');
select lives_ok(format('select public.close_poll(%s)', :'poll'), 'a mod closes the poll');
select tests.clear_authentication();

select tests.authenticate_as(:'bob');
select throws_ok(format('select public.vote_poll(%s, %s)', :'poll', :'opt2'),
  'P0001', 'this poll is closed', 'voting after close is rejected');
select is((select (public.poll_results(:'poll'))->>'results_visible'), 'true', 'a non-voter sees results once the poll is closed');
select tests.clear_authentication();

-- A poll past closes_at is closed on read even without close_poll.
update public.polls set closes_at = now() - interval '1 minute' where id = :'poll3';
select tests.authenticate_as(:'bob');
select throws_ok(format('select public.vote_poll(%s, %s)', :'poll3', (select id from public.poll_options where poll_id = :'poll3' limit 1)),
  'P0001', 'this poll is closed', 'a poll past its close time rejects votes');
select tests.clear_authentication();

-- 5. Hidden polls disappear from active_polls --------------------------------
select tests.authenticate_as(:'mod');
select public.hide_poll(:'poll2');
select tests.clear_authentication();

select tests.authenticate_as(:'bob');
select is((select count(*) from public.active_polls(10) a where (a->>'id')::bigint = :'poll2'), 0::bigint,
  'a hidden poll is not in active_polls');
select is((select array_agg((a->>'status')::text order by (a->>'id')::bigint) from public.active_polls(10) a),
  array['closed', 'closed'], 'the closed polls still show (recently closed) with status closed');
select tests.clear_authentication();

select * from finish();
rollback;
