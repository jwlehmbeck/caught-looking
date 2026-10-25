begin;
select plan(12);

select tests.create_user('alice') as alice \gset
select tests.create_user('bob') as bob \gset
select tests.create_user('max_mod') as mod \gset
select tests.grant_role(:'mod', 'mod');
select tests.create_game(14::smallint, 19::smallint, now() - interval '1 minute', 'live') as game \gset

-- Seed content as the service role.
insert into public.posts (author_id, kind, status, title, storage_path)
values (:'alice', 'fan_edit', 'pending', 'My rally-cap edit', 'uploads/' || :'alice' || '/a.mp4');
insert into public.posts (author_id, kind, status, title, url)
values (:'bob', 'mlb_clip', 'live', 'Catch of the night', 'https://www.mlb.com/video/catch');

-- Direct inserts by members are rejected, one test per table.
select tests.authenticate_as(:'bob');
select throws_ok($$ insert into public.chat_messages (game_id, author_id, body) values (1, current_setting('request.jwt.claim.sub')::uuid, 'hi') $$,
  '42501', null, 'direct insert into chat_messages is rejected');
select throws_ok($$ insert into public.posts (author_id, kind, status, title, url) values (current_setting('request.jwt.claim.sub')::uuid, 'news', 'live', 'x', 'https://x.example') $$,
  '42501', null, 'direct insert into posts is rejected');
select throws_ok($$ insert into public.comments (post_id, author_id, body) values (1, current_setting('request.jwt.claim.sub')::uuid, 'hi') $$,
  '42501', null, 'direct insert into comments is rejected');
select throws_ok($$ insert into public.votes (user_id, post_id) values (current_setting('request.jwt.claim.sub')::uuid, 1) $$,
  '42501', null, 'direct insert into votes is rejected');
select throws_ok($$ insert into public.poll_votes (poll_id, user_id, option_id) values (1, current_setting('request.jwt.claim.sub')::uuid, 1) $$,
  '42501', null, 'direct insert into poll_votes is rejected');
select throws_ok($$ insert into public.reports (reporter_id, target_type, target_id, category) values (current_setting('request.jwt.claim.sub')::uuid, 'post', '1', 'spam') $$,
  '42501', null, 'direct insert into reports is rejected');

-- Bob cannot read Alice's pending upload; Alice can.
select is((select count(*) from public.posts where author_id = :'alice'), 0::bigint,
  'another member cannot see a pending fan edit');
select tests.authenticate_as(:'alice');
select is((select count(*) from public.posts where author_id = :'alice'), 1::bigint,
  'the uploader can see their own pending fan edit');

-- A mod can mute for 24h but cannot ban.
select tests.authenticate_as(:'mod');
select lives_ok(format('select public.issue_sanction(%L, %L, %L, 2)', :'bob', 'chat_mute', 'spamming the chat'),
  'a mod can mute in chat');
select throws_ok(format('select public.issue_sanction(%L, %L, %L, null)', :'bob', 'ban', 'test'),
  '42501', 'mods can only mute in chat', 'a mod cannot ban');
select throws_ok(format('select public.issue_sanction(%L, %L, %L, 48)', :'bob', 'chat_mute', 'test'),
  '42501', 'mod mutes last at most 24 hours', 'a mod cannot mute longer than 24 hours');

-- Every mod action is logged.
select tests.clear_authentication();
select is((select count(*) from public.mod_actions where actor_id = :'mod'), 1::bigint, 'the mute was audit-logged');

select * from finish();
rollback;
