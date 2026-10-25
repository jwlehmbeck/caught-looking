begin;
select plan(34);

-- Invite codes ---------------------------------------------------------------
insert into public.invite_codes (code_hash, max_uses) values (private.hash_invite_code('GOOD-CODE'), 2);
insert into public.invite_codes (code_hash, max_uses, expires_at)
values (private.hash_invite_code('OLDC-ODEX'), 5, now() - interval '1 day');
insert into public.invite_codes (code_hash, max_uses, used_count) values (private.hash_invite_code('USED-UPXX'), 1, 1);

select tests.authenticate_as_service();
select is(private.redeem_invite_code('NOPE-NOPE'), false, 'an unknown invite code is rejected');
select is(private.redeem_invite_code('OLDC-ODEX'), false, 'an expired invite code is rejected');
select is(private.redeem_invite_code('USED-UPXX'), false, 'a fully used invite code is rejected');
select is(private.redeem_invite_code(null), false, 'no code is rejected while public signup is closed');
select is(private.redeem_invite_code('good-code', false), true, 'a dry run accepts a valid code (case-insensitive)');
select is(private.redeem_invite_code('GOOD-CODE'), true, 'a valid invite code is accepted');
select tests.clear_authentication();
select is((select used_count from public.invite_codes where code_hash = private.hash_invite_code('GOOD-CODE')),
          1, 'a valid code''s use count goes up by one');
select is((select used_count from public.invite_codes where code_hash = private.hash_invite_code('GOOD-CODE')),
          1, 'a dry run did not count a use');

update public.app_settings set value = 'true'::jsonb where key = 'public_signup_open';
select tests.authenticate_as_service();
select is(private.redeem_invite_code(null), true, 'no code is fine once public signup is open');
select is(private.redeem_invite_code('NOPE-NOPE'), false, 'but a wrong code still fails when typed');
select tests.clear_authentication();
update public.app_settings set value = 'false'::jsonb where key = 'public_signup_open';

-- Only the service role may call these ---------------------------------------
select tests.create_user('alice') as alice \gset
select tests.authenticate_as(:'alice');
select throws_ok(
  $$ select private.redeem_invite_code('GOOD-CODE') $$, '42501', null,
  'an authenticated user cannot call redeem_invite_code');
select throws_ok(
  $$ select private.signup_create_profile(gen_random_uuid(), 'Mallory', 'mallory', 14::smallint, 2010::smallint) $$,
  '42501', null, 'an authenticated user cannot call signup_create_profile');
select throws_ok(
  $$ select private.record_recovery_result(gen_random_uuid(), true) $$, '42501', null,
  'an authenticated user cannot call record_recovery_result');
select tests.clear_authentication();

-- Signup profile creation ----------------------------------------------------
insert into public.username_holds (normalized_username, released_at) values ('oldtimer', now() + interval '30 days');
insert into public.username_holds (normalized_username, released_at) values ('freeagain', now() - interval '1 day');
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '11111111-1111-1111-1111-111111111111@users.caughtlooking.invalid', now(), now());

select tests.authenticate_as_service();
select throws_ok(
  $$ select private.signup_create_profile(gen_random_uuid(), 'Admin', 'admin', 14::smallint, 2010::smallint) $$,
  'P0001', 'username is reserved', 'a reserved username is rejected');
select throws_ok(
  $$ select private.signup_create_profile(gen_random_uuid(), 'OldTimer', 'oldtimer', 14::smallint, 2010::smallint) $$,
  'P0001', 'username is held', 'a held username is rejected');
select throws_ok(
  $$ select private.signup_create_profile(gen_random_uuid(), 'ALICE', 'alice', 14::smallint, 2010::smallint) $$,
  '23505', 'username is taken', 'a duplicate normalized username is rejected');
select is(private.username_available('freeagain'), true, 'a released hold is available again');
select is(private.username_available('mlb'), false, 'username_available says no to reserved names');

-- A real signup: the auth user exists first (the action creates it), then the profile.
select lives_ok(
  $$ select private.signup_create_profile('11111111-1111-1111-1111-111111111111', 'Slide_Step', 'slide_step', 14::smallint, 2011::smallint) $$,
  'a valid signup creates the profile');
select is((select birth_year from public.profiles_private where user_id = '11111111-1111-1111-1111-111111111111'),
          2011::smallint, 'the private row holds only the birth year');
select is((select user_id from private.lookup_login('slide_step')), '11111111-1111-1111-1111-111111111111'::uuid,
          'lookup_login resolves the normalized username');
select is((select count(*) from private.lookup_login('nobody_here')), 0::bigint, 'lookup_login finds nothing for unknown names');

-- Recovery -------------------------------------------------------------------
select private.set_recovery_code(:'alice', '$2a$10$firsthash');
select private.set_recovery_code(:'alice', '$2a$10$secondhash');
select is((select code_hash from private.get_recovery_hash('alice')), '$2a$10$secondhash',
          'get_recovery_hash returns the newest unused hash');
select is((select count(*) from public.recovery_codes where user_id = :'alice' and used_at is not null), 1::bigint,
          'setting a new code retires the old one');
select is((select locked from private.get_recovery_hash('alice')), false, 'recovery starts unlocked');

select is(private.record_recovery_result(:'alice', false), false, 'one wrong code does not lock');
select private.record_recovery_result(:'alice', false);
select private.record_recovery_result(:'alice', false);
select private.record_recovery_result(:'alice', false);
select is(private.record_recovery_result(:'alice', false), true, 'the fifth wrong code locks recovery');
select is((select locked from private.get_recovery_hash('alice')), true, 'get_recovery_hash reports the lock');
select is(private.record_recovery_result(:'alice', true), true, 'a right code during the lock is still refused');

-- Time passes: the lock expires.
update public.profiles_private set recovery_locked_until = now() - interval '1 minute' where user_id = :'alice';
select is(private.record_recovery_result(:'alice', true), false, 'the right code works after the lock expires');
select is((select code_hash from private.get_recovery_hash('alice')), null,
          'a used code stops working (no unused hash left)');

-- Per-IP throttle.
select is((select bool_and(private.recovery_ip_allowed('ip-a')) from generate_series(1, 5)), true,
          'five attempts from one IP are allowed');
select is(private.recovery_ip_allowed('ip-a'), false, 'the sixth attempt from that IP within an hour is refused');
select is(private.recovery_ip_allowed('ip-b'), true, 'a different IP is unaffected');
select tests.clear_authentication();

select * from finish();
rollback;
