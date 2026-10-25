begin;
select plan(10);

select tests.create_user('alice') as alice \gset
select tests.create_user('bob') as bob \gset
select tests.create_user('ada_admin') as admin \gset
select tests.grant_role(:'admin', 'admin');
select tests.create_game(14::smallint, 19::smallint) as game \gset

insert into public.posts (author_id, kind, status, title, storage_path)
values (:'alice', 'fan_edit', 'live', 'Alice edit', 'uploads/' || :'alice' || '/a.mp4');
insert into public.posts (author_id, kind, status, title, url)
values (:'bob', 'mlb_clip', 'live', 'Bob clip', 'https://www.mlb.com/video/x') returning id as bob_post \gset
insert into public.comments (post_id, author_id, body) values (:'bob_post', :'alice', 'great catch');
insert into public.picks (user_id, game_id, team_id) values (:'alice', :'game', 14);
update public.games set app_state = 'live', lock_at = now() - interval '1 minute' where id = :'game';

-- Plain deletion: anonymize.
select tests.authenticate_as(:'alice');
select is((select public.delete_account()), false, 'alice deletes her account without a safety hold');

select tests.clear_authentication();
select is((select status from public.profiles where id = :'alice'), 'deleted', 'profile is tombstoned');
select matches((select username from public.profiles where id = :'alice'), '^deleted_', 'username is anonymized');
select is((select body from public.comments where post_id = :'bob_post'), '[deleted]', 'comments are anonymized');
select is((select count(*) from public.picks where game_id = :'game' and user_id is null), 1::bigint, 'picks are detached, not deleted');
select is((select count(*) from public.profiles_private where user_id = :'alice'), 0::bigint, 'private row is gone');
select is((select count(*) from public.deletion_queue), 1::bigint, 'the uploaded file is queued for purging');
select is((select count(*) from public.username_holds where normalized_username = 'alice'), 1::bigint, 'the username is held');

-- Deletion under an open urgent report: content is held, not erased.
insert into public.reports (reporter_id, target_type, target_id, category)
values (:'admin', 'profile', :'bob', 'urgent');
select tests.authenticate_as(:'bob');
select is((select public.delete_account()), true, 'bob''s deletion applies a safety hold');
select tests.clear_authentication();
select is((select status from public.posts where id = :'bob_post'), 'held', 'held content keeps its body and is admin-only');

select * from finish();
rollback;
