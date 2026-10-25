begin;
select plan(25);

-- People -------------------------------------------------------------------
select tests.create_user('alice') as alice \gset
select tests.create_user('bob') as bob \gset
select tests.create_user('max_mod') as mod \gset
select tests.grant_role(:'mod', 'mod');
select tests.create_user('ann_admin', 14::smallint, 1980::smallint) as admin \gset
select tests.grant_role(:'admin', 'admin');
select tests.create_game(14::smallint, 19::smallint, now() - interval '1 minute', 'live') as game \gset

-- Content (seeded as postgres, which bypasses RLS) -------------------------
insert into public.posts (author_id, kind, status, title, url)
values (:'bob', 'mlb_clip', 'live', 'Catch of the night', 'https://www.mlb.com/video/catch')
returning id as bob_post \gset
insert into public.comments (post_id, author_id, body)
values (:'bob_post', :'alice', 'that changeup was filthy')
returning id as alice_comment \gset
insert into public.posts (author_id, kind, status, title, url)
values (:'mod', 'mlb_clip', 'live', 'Mod''s own post', 'https://www.mlb.com/video/mod')
returning id as mod_post \gset

-- 1. Fifteen reports on one comment collapse into one queue row -------------
do $$
declare
  u uuid;
  i integer;
begin
  for i in 1..15 loop
    u := tests.create_user('reporter_' || i);
    perform tests.authenticate_as(u);
    perform public.file_report('comment', (select id::text from public.comments where body = 'that changeup was filthy'),
      case when i % 2 = 0 then 'spam' else 'bullying' end, null);
    perform tests.clear_authentication();
  end loop;
end $$;

select tests.authenticate_as(:'mod');
select is((select count(*) from public.mod_queue() where target_type = 'comment' and target_id = :'alice_comment'::text),
  1::bigint, '15 reports on one comment make one queue row');
select is((select report_count from public.mod_queue() where target_type = 'comment' and target_id = :'alice_comment'::text),
  15, 'the queue row counts 15 reports');
select is((select categories from public.mod_queue() where target_type = 'comment' and target_id = :'alice_comment'::text),
  array['bullying', 'spam'], 'the queue row lists the categories');
select is((select author_id from public.mod_queue() where target_type = 'comment' and target_id = :'alice_comment'::text),
  :'alice'::uuid, 'the queue row names the author');
select is((select snippet from public.mod_queue() where target_type = 'comment' and target_id = :'alice_comment'::text),
  'that changeup was filthy', 'the queue row carries a snippet');
select tests.clear_authentication();

-- A second report of the same thing by the same person is a no-op.
select tests.authenticate_as(:'bob');
select lives_ok(format('select public.file_report(%L, %L, %L, %L)', 'comment', :'alice_comment', 'spam', 'first'),
  'bob reports the comment');
select lives_ok(format('select public.file_report(%L, %L, %L, %L)', 'comment', :'alice_comment', 'bullying', 'again'),
  'reporting the same thing twice does not fail');
select is((select count(*) from public.reports where reporter_id = :'bob'), 1::bigint,
  'the duplicate collapsed into one report');
select tests.clear_authentication();

-- 2. Twenty reports a day, no more -------------------------------------------
do $$
declare
  i integer;
  m bigint;
  game_id bigint := (select id from public.games order by id desc limit 1);
begin
  for i in 1..20 loop
    insert into public.chat_messages (game_id, author_id, body) values (game_id, (select id from public.profiles where username = 'bob'), 'msg ' || i)
      returning id into m;
    perform tests.authenticate_as((select id from public.profiles where username = 'alice'));
    perform public.file_report('chat_message', m::text, 'spam', null);
    perform tests.clear_authentication();
  end loop;
end $$;
select is((select count(*) from public.reports where reporter_id = :'alice'), 20::bigint, 'alice has filed 20 reports today');
select tests.authenticate_as(:'alice');
select throws_ok(format('select public.file_report(%L, %L, %L, null)', 'post', :'bob_post', 'spam'),
  'P0001', 'report limit reached, try again tomorrow', 'the 21st report in a day is rejected');
select tests.clear_authentication();

-- 3. Conflict of interest -----------------------------------------------------
select tests.authenticate_as(:'bob');
select public.file_report('post', :'mod_post'::text, 'inappropriate', null) as mod_post_report \gset
select tests.clear_authentication();

select tests.authenticate_as(:'mod');
select throws_ok(format('select public.resolve_report(%s, %L)', :'mod_post_report', 'dismissed'),
  '42501', 'you cannot act on reports about yourself', 'a mod cannot resolve a report about their own post');
select throws_ok(format('select public.hide_content(%L, %L, true)', 'post', :'mod_post'),
  '42501', 'you cannot act on your own content', 'a mod cannot hide their own post');
select lives_ok(format('select public.hide_content(%L, %L, true)', 'comment', :'alice_comment'),
  'a mod can hide someone else''s comment');
select is((select status from public.comments where id = :'alice_comment'), 'hidden', 'the comment is hidden');
select tests.clear_authentication();

-- 4. under_13 and urgent reach only admins -----------------------------------
select tests.authenticate_as(:'bob');
select public.file_report('profile', :'alice'::text, 'under_13', 'she said she is 12') as u13_report \gset
select tests.clear_authentication();
select is((select count(*) from public.alert_log where kind = 'urgent_report' and (details->>'report_id')::bigint = :'u13_report'),
  1::bigint, 'the under_13 report raised an admin alert');

select tests.authenticate_as(:'mod');
select is((select count(*) from public.mod_queue() where target_type = 'profile'), 0::bigint,
  'a mod does not see the under_13 report in the queue');
select is((select count(*) from public.reports where category = 'under_13'), 0::bigint,
  'a mod cannot select under_13 reports');
select throws_ok(format('select public.resolve_report(%s, %L)', :'u13_report', 'resolved'),
  '42501', 'only admins handle this report', 'a mod cannot resolve an under_13 report');
select tests.clear_authentication();

select tests.authenticate_as(:'admin');
select is((select urgent from public.mod_queue() where target_type = 'profile' and target_id = :'alice'::text), true,
  'an admin sees the under_13 report, marked urgent');
select is((select target_type from public.mod_queue() limit 1), 'profile',
  'urgent groups come first for admins');
select tests.clear_authentication();

-- 5. Blocking --------------------------------------------------------------
select tests.authenticate_as(:'alice');
select public.block_user(:'bob'::uuid);
select is(private.is_blocked_by_viewer(:'bob'::uuid), true, 'alice has bob blocked');
select tests.clear_authentication();
select tests.authenticate_as(:'bob');
select is(private.is_blocked_by_viewer(:'alice'::uuid), false, 'the block is one-way');
select tests.clear_authentication();

-- 6. Invite codes ----------------------------------------------------------
select tests.authenticate_as(:'mod');
select throws_ok('select public.create_invite_codes(3, 1, null)', '42501', 'not allowed',
  'a mod cannot create invite codes');
select tests.clear_authentication();

select tests.authenticate_as(:'admin');
select array_agg(code) as codes from public.create_invite_codes(3, 2, now() + interval '7 days') as code \gset
select tests.clear_authentication();
select is((select count(*) from unnest(:'codes'::text[]) code where code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'), 3::bigint,
  'three codes shaped XXXX-XXXX without 0/O/1/I');
select is(
  (select count(*) from unnest(:'codes'::text[]) c(code) join public.invite_codes i
     on i.code_hash = encode(extensions.digest(c.code, 'sha256'), 'hex')),
  3::bigint, 'each returned code''s sha256 matches a stored hash');

select * from finish();
rollback;
