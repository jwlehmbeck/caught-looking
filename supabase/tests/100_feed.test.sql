begin;
select plan(30);

-- People and a game -----------------------------------------------------------
select tests.create_user('alice', 14::smallint) as alice \gset
select tests.create_user('bob', 19::smallint) as bob \gset
select tests.create_user('carl', 14::smallint) as carl \gset
select tests.create_user('sue_suspended', 14::smallint) as sue \gset
insert into public.sanctions (user_id, kind, reason) values (:'sue', 'suspension', 'test');
select tests.create_game(14::smallint, 19::smallint, now() - interval '4 hours', 'final') as game \gset
update public.games set home_score = 5, away_score = 2, ended_at = now() - interval '1 hour',
  highlights = '[{"title": "Walk-off single", "url": "https://www.mlb.com/video/walk-off-1", "durationSeconds": 42},
                 {"title": "Diving catch", "url": "https://www.mlb.com/video/diving-catch-2"},
                 {"title": "Bad host", "url": "https://evil.example/video/x"},
                 {"title": "", "url": "https://www.mlb.com/video/no-title"}]'::jsonb
 where id = :'game';

-- 1. Highlight ingest creates posts and is idempotent ------------------------
select tests.authenticate_as_service();
select is(public.scorer_ingest_highlights(:'game'), 2, 'two MLB.com highlights become posts (bad host and empty title skipped)');
select is(public.scorer_ingest_highlights(:'game'), 0, 'ingesting the same game again creates nothing');
select tests.clear_authentication();
select is((select count(*) from public.posts where game_id = :'game' and kind = 'mlb_clip' and status = 'live' and author_id is null), 2::bigint,
  'highlight posts are live, authorless mlb_clip posts');
select is((select count(*) from public.posts where game_id = :'game' and team_id = 14), 2::bigint,
  'highlight posts are tagged with the home team when no winner is set');
select is((select count(*) from public.posts where storage_path is not null), 0::bigint, 'no media file path is ever stored for an MLB clip');

-- 2. News ingest, idempotent -------------------------------------------------
select tests.authenticate_as_service();
select is(public.scorer_ingest_news('Trade deadline recap', 'https://www.mlb.com/news/recap', now() - interval '2 hours'), true, 'a news item becomes a post');
select is(public.scorer_ingest_news('Trade deadline recap', 'https://www.mlb.com/news/recap', now()), false, 'the same link is not stored twice');
select tests.clear_authentication();

-- 3. Members cannot call the service-only writers ---------------------------
select tests.authenticate_as(:'alice');
select throws_ok(format('select public.create_link_post(%L, %L, %L, null, null)', :'alice', 'Title', 'https://www.mlb.com/video/x'),
  '42501', null, 'a member cannot call create_link_post');
select throws_ok(format('select public.add_comment(%L, 1, %L, null, %L)', :'alice', 'hi', 'live'),
  '42501', null, 'a member cannot call add_comment');
select throws_ok(format('select public.scorer_ingest_highlights(%s)', :'game'),
  '42501', null, 'a member cannot call scorer_ingest_highlights');
select tests.clear_authentication();

-- 4. Link posts through the service path ------------------------------------
select tests.authenticate_as_service();
select public.create_link_post(:'bob', 'Bob''s favorite catch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 19::smallint, null) as bob_post \gset
select throws_ok(format('select public.create_link_post(%L, %L, %L, null, null)', :'alice', 'Nope', 'https://evil.example/clip'),
  '22023', 'link not allowed', 'a non-allow-listed link is rejected even by the service path');
select throws_ok(format('select public.create_link_post(%L, %L, %L, null, null)', :'alice', 'Dup', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  '23505', 'already shared', 'the same link cannot be shared twice');
select throws_ok(format('select public.create_link_post(%L, %L, %L, null, null)', :'sue', 'Sue', 'https://www.mlb.com/video/sue'),
  '42501', 'suspended', 'a suspended user cannot share a link');
select tests.clear_authentication();

-- 5. Votes toggle and the score tracks ---------------------------------------
select tests.authenticate_as(:'alice');
select is((select voted from public.toggle_vote(:'bob_post')), true, 'first tap votes');
select is((select vote_score from public.posts where id = :'bob_post'), 1, 'vote_score is 1 after one vote');
select is((select voted from public.toggle_vote(:'bob_post')), false, 'second tap removes the vote');
select is((select vote_score from public.posts where id = :'bob_post'), 0, 'vote_score is back to 0');
select public.toggle_vote(:'bob_post');
select is((select viewer_voted from public.feed('hot', 0, 20) where id = :'bob_post'), true, 'the feed reports the viewer''s vote');
select tests.clear_authentication();

select tests.authenticate_as(:'sue');
select throws_ok(format('select public.toggle_vote(%s)', :'bob_post'), '42501', 'your account is suspended', 'a suspended user cannot vote');
select tests.clear_authentication();

-- 6. Comments: count tracks, one reply level ---------------------------------
select tests.authenticate_as_service();
select id as c1 from public.add_comment(:'carl', :'bob_post', 'that changeup was filthy', null, 'live') \gset
select id as c2 from public.add_comment(:'alice', :'bob_post', 'agreed', :'c1', 'live') \gset
select is((select comment_count from public.posts where id = :'bob_post'), 2, 'comment_count counts live comments');
select throws_ok(format('select public.add_comment(%L, %s, %L, %s, %L)', :'carl', :'bob_post', 'reply to a reply', :'c2', 'live'),
  '23514', 'replies can only be one level deep', 'a second-level reply is rejected');
select id as c3 from public.add_comment(:'carl', :'bob_post', 'held one', null, 'hidden') \gset
select is((select comment_count from public.posts where id = :'bob_post'), 2, 'a held comment does not count');
select tests.clear_authentication();

-- 7. Blocking hides the author's posts and comments ---------------------------
select tests.authenticate_as(:'alice');
select is((select count(*) from public.post_comments(:'bob_post') where id = :'c1'), 1::bigint, 'alice sees carl''s comment before blocking');
select public.block_user(:'carl');
select is((select count(*) from public.post_comments(:'bob_post') where author_id = :'carl'), 0::bigint, 'alice no longer sees carl''s comments');
select public.block_user(:'bob');
select is((select count(*) from public.feed('new', 0, 50) where id = :'bob_post'), 0::bigint, 'alice no longer sees bob''s post in the feed');
select is((select count(*) from public.post_detail(:'bob_post')), 0::bigint, 'nor on its detail page');
select tests.clear_authentication();

-- 8. Non-live posts never show; My Team filters by favorite team ------------
update public.posts set status = 'hidden' where title = 'Diving catch';
select tests.authenticate_as(:'bob');
select is((select count(*) from public.feed('new', 0, 50) where title = 'Diving catch'), 0::bigint, 'hidden posts are not in the feed');
select is((select count(*) from public.feed('my_team', 0, 50) where team_id <> 19), 0::bigint, 'my_team (bob: team 19) shows only team-19 posts');
select is((select count(*) from public.feed('my_team', 0, 50) where id = :'bob_post'), 1::bigint, 'my_team includes bob''s own team-19 post');
select is((select count(*) from public.feed('hot', 0, 50)), 3::bigint, 'hot shows every live post for a viewer with no blocks');
select tests.clear_authentication();

select * from finish();
rollback;
