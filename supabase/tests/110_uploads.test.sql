begin;
select plan(33);

-- People -------------------------------------------------------------------
select tests.create_user('uma') as uma \gset
select tests.create_user('vic') as vic \gset
select tests.create_user('max_mod') as mod \gset
select tests.grant_role(:'mod', 'mod');
select tests.create_user('ann_admin', 14::smallint, 1980::smallint) as admin \gset
select tests.grant_role(:'admin', 'admin');

-- 1. Members cannot call the service RPCs -----------------------------------
select tests.authenticate_as(:'uma');
select throws_ok(
  format('select public.uploads_register(%L, %L, %L)', :'uma', 'uploads/' || :'uma' || '/11111111-1111-4111-8111-111111111111.mp4', 'mine'),
  '42501', null, 'a member cannot call uploads_register');
select throws_ok('select public.uploads_apply_scan(1, ''queue'')', '42501', null, 'a member cannot call uploads_apply_scan');
select throws_ok('select public.uploads_mark_scanning(1)', '42501', null, 'a member cannot call uploads_mark_scanning');
select throws_ok('select * from public.uploads_pending_scans()', '42501', null, 'a member cannot call uploads_pending_scans');
select tests.clear_authentication();

-- 2. Registering: three a day, then no more ----------------------------------
select tests.authenticate_as_service();
select public.uploads_register(:'uma', 'uploads/' || :'uma' || '/11111111-1111-4111-8111-111111111111.mp4', 'Walk-off edit', 14::smallint, null, 45::smallint,
  'uploads/' || :'uma' || '/11111111-1111-4111-8111-111111111111.jpg') as p1 \gset
select public.uploads_register(:'uma', 'uploads/' || :'uma' || '/22222222-2222-4222-8222-222222222222.mp4', 'Second edit') as p2 \gset
select public.uploads_register(:'uma', 'uploads/' || :'uma' || '/33333333-3333-4333-8333-333333333333.mov', 'Third edit') as p3 \gset
select throws_ok(
  format('select public.uploads_register(%L, %L, %L)', :'uma', 'uploads/' || :'uma' || '/44444444-4444-4444-8444-444444444444.mp4', 'Fourth'),
  'P0001', 'upload limit reached, try again tomorrow', 'the fourth upload in a day is rejected');
select throws_ok(
  format('select public.uploads_register(%L, %L, %L)', :'vic', 'uploads/' || :'uma' || '/55555555-5555-4555-8555-555555555555.mp4', 'Not my folder'),
  '22023', 'bad storage path', 'a path in another user''s folder is rejected');
select throws_ok(
  format('select public.uploads_register(%L, %L, %L, null, null, %s)', :'vic', 'uploads/' || :'vic' || '/55555555-5555-4555-8555-555555555555.mp4', 'Too long', '61::smallint'),
  '22023', 'clips are 60 seconds or less', 'a 61 second client duration is rejected');
select is((select status from public.posts where id = :'p1'), 'pending', 'a registered upload starts pending');
select is((select status from public.upload_scans where post_id = :'p1'), 'queued', 'a registered upload has a queued scan row');
select is((select count(*) from public.posts where author_id = :'uma' and kind = 'fan_edit'), 3::bigint, 'three uploads registered');

-- 3. Scanning and routing ----------------------------------------------------
select lives_ok(format('select public.uploads_mark_scanning(%s, %L, %L)', :'p1', 'job-1', 's3/key-1'), 'mark_scanning works');
select is((select status from public.posts where id = :'p1'), 'scanning', 'mark_scanning moves the post to scanning');
select is((select count(*) from public.uploads_pending_scans(interval '0 seconds')), 1::bigint, 'the sweep sees the scanning job');
select is((select count(*) from public.uploads_pending_scans()), 0::bigint, 'the sweep ignores jobs younger than 15 minutes');

-- queue -> pending with a complete scan
select lives_ok(format('select public.uploads_apply_scan(%s, %L, %L::jsonb)', :'p1', 'queue',
  '{"labels": [], "duration_ms": 45000, "csam_checked": true}'), 'apply_scan queue works');
select is((select status from public.posts where id = :'p1'), 'pending', 'queue puts the post back to pending');
select is((select status || ':' || duration_ms::text from public.upload_scans where post_id = :'p1'), 'complete:45000', 'queue completes the scan row');

-- reject with a reason
select public.uploads_mark_scanning(:'p2', 'job-2', 's3/key-2');
select lives_ok(format('select public.uploads_apply_scan(%s, %L, %L::jsonb)', :'p2', 'reject', '{"reason": "unsafe", "labels": [{"Name": "Explicit Nudity", "Confidence": 99}]}'),
  'apply_scan reject works');
select is((select status || ':' || rejection_reason from public.posts where id = :'p2'), 'rejected:unsafe', 'reject sets the status and reason');
select is((select count(*) from public.alert_log where kind = 'upload_auto_rejected' and (details ->> 'post_id')::bigint = :'p2'), 1::bigint,
  'an unsafe auto-reject alerts the admin');
select is((select count(*) from public.deletion_queue where storage_path = 'uploads/' || :'uma' || '/22222222-2222-4222-8222-222222222222.mp4'), 1::bigint,
  'a rejected file is queued for purging');

-- quarantine -> held + alert, never in the queue
select public.uploads_mark_scanning(:'p3', 'job-3', 's3/key-3');
select lives_ok(format('select public.uploads_apply_scan(%s, %L, %L::jsonb)', :'p3', 'quarantine', '{"csam_checked": true}'), 'apply_scan quarantine works');
select is((select status from public.posts where id = :'p3'), 'held', 'quarantine holds the post');
select is((select count(*) from public.alert_log where kind = 'csam_quarantine' and (details ->> 'post_id')::bigint = :'p3'), 1::bigint,
  'quarantine writes a csam_quarantine alert row');

-- a late callback cannot flip a decision
select public.uploads_apply_scan(:'p3', 'queue', '{}'::jsonb);
select is((select status from public.posts where id = :'p3'), 'held', 'a late queue outcome does not un-hold a quarantined post');
select tests.clear_authentication();

-- 4. Queues and member views -------------------------------------------------
select tests.authenticate_as(:'admin');
select is((select array_agg(id order by id) from public.upload_queue()), array[:'p1']::bigint[], 'the admin queue lists only the pending post, never the held one');
select tests.clear_authentication();

select tests.authenticate_as(:'uma');
select is((select status || ':' || rejection_reason from public.my_uploads() where id = :'p2'), 'rejected:unsafe', 'my_uploads shows the rejection reason');
select is((select status from public.my_uploads() where id = :'p3'), 'pending', 'my_uploads shows a held upload as pending to its uploader');
select throws_ok(format('select public.approve_upload(%s, %L)', :'p1', 'media/' || repeat('a', 64) || '.mp4'), '42501', null, 'a member cannot approve');
select tests.clear_authentication();

-- 5. Approve / reject are admin only -----------------------------------------
select tests.authenticate_as(:'mod');
select throws_ok(format('select public.approve_upload(%s, %L)', :'p1', 'media/' || repeat('a', 64) || '.mp4'), '42501', null, 'a mod cannot approve an upload');
select throws_ok(format('select public.reject_upload(%s, %L)', :'p1', 'quality'), '42501', null, 'a mod cannot reject an upload');
select tests.clear_authentication();

select tests.authenticate_as(:'admin');
select lives_ok(format('select public.approve_upload(%s, %L)', :'p1', 'media/' || repeat('a', 64) || '.mp4'), 'an admin approves');
select is((select status || ':' || storage_path from public.posts where id = :'p1'), 'live:media/' || repeat('a', 64) || '.mp4',
  'approval makes the post live on its media path');
select tests.clear_authentication();

-- 6. Storage policies, only where the storage schema exists --------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.objects') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'uploads: owner inserts video') then
      raise exception 'uploads insert policy missing';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE' and policyname like 'uploads:%') then
      raise exception 'uploads bucket must be write-once (no update policy)';
    end if;
  end if;
end $$;

select * from finish();
rollback;
