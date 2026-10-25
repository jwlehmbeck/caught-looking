begin;
select plan(1);

-- Public signups are off in supabase/config.toml, so the only way to create
-- a user is the server-side signup action. This test pins the matching
-- database-side fact: anon and authenticated roles cannot create auth users
-- directly.
select throws_ok(
  $$ set local role anon;
     insert into auth.users (id, email) values (gen_random_uuid(), 'x@users.caughtlooking.invalid') $$,
  '42501',
  null,
  'anon cannot insert into auth.users'
);

select * from finish();
rollback;
