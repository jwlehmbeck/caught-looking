begin;
select plan(3);

-- The local stack is up and pgTAP works.
select ok(true, 'pgTAP runs');

-- The extensions the plan relies on are available in this image.
select has_extension('pgcrypto', 'pgcrypto is installed (used for hashing recovery codes)');
select ok(
  exists (select 1 from pg_available_extensions where name = 'pg_cron'),
  'pg_cron is available for the poller and scorer schedules'
);

select * from finish();
rollback;
