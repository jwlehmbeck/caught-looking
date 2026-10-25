begin;
select plan(8);

select tests.create_user('poll_member', 14::smallint, 2010::smallint) as member \gset
select tests.create_user('poll_mod', 19::smallint, 2009::smallint) as mod \gset
select tests.create_user('poll_admin', 5::smallint, 1985::smallint) as admin \gset
select tests.grant_role(:'mod', 'mod');
select tests.grant_role(:'admin', 'admin');

select has_table('public', 'alert_log', 'alert_log exists');

-- The service role records an alert (as the poller does).
select tests.authenticate_as_service();
select lives_ok(
  $$ select private.record_alert('poller_failure', 'poll-games has failed 3 times in a row', '{"consecutiveFailures": 3}'::jsonb) $$,
  'service role can record an alert'
);
select is(
  (select count(*) from public.alert_log where kind = 'poller_failure'),
  1::bigint,
  'the alert was stored'
);
select tests.clear_authentication();

-- Members see nothing and cannot write.
select tests.authenticate_as(:'member');
select is(
  (select count(*) from public.alert_log), 0::bigint, 'a member cannot read alert_log'
);
select throws_ok(
  $$ insert into public.alert_log (kind, message) values ('other', 'nope') $$,
  '42501', null, 'a member cannot insert into alert_log'
);
select throws_ok(
  $$ select private.record_alert('other', 'nope', null) $$,
  '42501', null, 'a member cannot call record_alert'
);

-- Mods are not admins.
select tests.authenticate_as(:'mod');
select is(
  (select count(*) from public.alert_log), 0::bigint, 'a mod cannot read alert_log'
);

-- Admins can read.
select tests.authenticate_as(:'admin');
select is(
  (select count(*) from public.alert_log where kind = 'poller_failure'), 1::bigint, 'an admin can read alert_log'
);

select * from finish();
rollback;
