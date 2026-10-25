begin;
select plan(3);

select tests.create_user('alice') as alice \gset

-- Members cannot call the service-only wrappers.
select tests.authenticate_as(:'alice');
select throws_ok($$ select public.auth_username_available('zed') $$, '42501', null,
  'a member cannot call auth_username_available');
select throws_ok($$ select * from public.auth_lookup_login('alice') $$, '42501', null,
  'a member cannot call auth_lookup_login');

-- The service role can.
select tests.authenticate_as_service();
select is((select status from public.auth_lookup_login('alice')), 'active', 'service role can look up a login');

select * from finish();
rollback;
