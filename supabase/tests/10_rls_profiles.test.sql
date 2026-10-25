begin;
select plan(9);

select tests.create_user('alice', 14::smallint, 2010::smallint) as alice \gset
select tests.create_user('bob', 19::smallint, 2011::smallint) as bob \gset
select tests.create_user('ada_admin', 5::smallint, 1985::smallint) as admin \gset
select tests.grant_role(:'admin', 'admin');

-- Every table has RLS on.
select is(
  (select count(*) from pg_tables t
   where schemaname = 'public'
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = t.schemaname and c.relname = t.tablename and c.relrowsecurity)),
  0::bigint,
  'every public table has row level security enabled'
);

-- Clients hold no write grants on any public table.
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0::bigint,
  'anon and authenticated have no write grants on public tables'
);

-- Usernames that differ only by case collide on normalized_username.
select throws_ok(
  $$ insert into public.profiles (id, username, normalized_username)
     values (gen_random_uuid(), 'ALICE', 'alice') $$,
  '23505',
  null,
  'a second profile normalizing to the same username is rejected'
);

-- Alice can read her own private row, not Bob's.
select tests.authenticate_as(:'alice');
select is(
  (select birth_year from public.profiles_private where user_id = :'alice'),
  2010::smallint,
  'owner can read their own birth year'
);
select is(
  (select count(*) from public.profiles_private where user_id = :'bob'),
  0::bigint,
  'another member cannot read a private profile row'
);
select is(
  (select username from public.profiles where id = :'bob'),
  'bob',
  'public profile fields are visible to members'
);
select throws_ok(
  $$ update public.profiles set username = 'alice2' where id = current_setting('request.jwt.claim.sub')::uuid $$,
  '42501',
  null,
  'a member cannot write to profiles directly'
);

-- Admins can read private rows.
select tests.authenticate_as(:'admin');
select is(
  (select count(*) from public.profiles_private where user_id = :'bob'),
  1::bigint,
  'admin can read private profile rows'
);

-- Anonymous visitors can read teams but not profiles.
select tests.clear_authentication();
set local role anon;
select is(
  (select count(*) from public.teams), 30::bigint, 'anon can read the 30 teams'
);

select * from finish();
rollback;
