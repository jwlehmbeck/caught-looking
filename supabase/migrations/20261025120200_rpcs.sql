-- Write paths for U2: make_pick, pick_split, issue_sanction, delete_account.
-- Later units add their own RPCs next to these.

-- Picks ---------------------------------------------------------------------

-- Make or change a pick. Unlimited changes before lock; the last one counts.
create or replace function public.make_pick(p_game_id bigint, p_team_id smallint)
returns public.picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pick public.picks;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if private.is_sanctioned(v_uid, array['suspension', 'ban']) then
    raise exception 'your account is suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;

  insert into public.picks (user_id, game_id, team_id)
  values (v_uid, p_game_id, p_team_id)
  on conflict (user_id, game_id) do update
    set team_id = excluded.team_id
  returning * into v_pick;

  return v_pick;
end;
$$;
revoke all on function public.make_pick(bigint, smallint) from public, anon;
grant execute on function public.make_pick(bigint, smallint) to authenticated;

-- Fan split for a game. Hidden until the viewer has picked (or the game has
-- locked), so nobody can copy the crowd.
create or replace function public.pick_split(p_game_id bigint)
returns table (home_count integer, away_count integer, total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  g public.games%rowtype;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then
    return;
  end if;

  if not (
    (g.app_state <> 'open' or now() >= g.lock_at)
    or exists (select 1 from public.picks where game_id = p_game_id and user_id = v_uid)
  ) then
    return; -- no rows: the caller shows "pick first"
  end if;

  return query
    select
      count(*) filter (where team_id = g.home_team_id)::integer,
      count(*) filter (where team_id = g.away_team_id)::integer,
      count(*)::integer
    from public.picks
    where game_id = p_game_id;
end;
$$;
revoke all on function public.pick_split(bigint) from public, anon;
grant execute on function public.pick_split(bigint) to authenticated;

-- Moderation ----------------------------------------------------------------

create or replace function private.log_mod_action(
  p_action text, p_target_type text, p_target_id text, p_details jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mod_actions (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, p_details);
$$;

-- Mods may only mute in chat for up to 24 hours. Admins may do anything.
create or replace function public.issue_sanction(
  p_user_id uuid, p_kind text, p_reason text, p_hours integer default null
)
returns public.sanctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sanctions;
  v_ends timestamptz;
begin
  if private.is_admin() then
    null;
  elsif private.is_staff() then
    if p_kind <> 'chat_mute' then
      raise exception 'mods can only mute in chat' using errcode = '42501';
    end if;
    if p_hours is null or p_hours > 24 then
      raise exception 'mod mutes last at most 24 hours' using errcode = '42501';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'you cannot sanction yourself' using errcode = '42501';
  end if;

  v_ends := case when p_hours is null then null else now() + make_interval(hours => p_hours) end;

  insert into public.sanctions (user_id, kind, reason, issued_by, ends_at)
  values (p_user_id, p_kind, p_reason, (select auth.uid()), v_ends)
  returning * into v_row;

  perform private.log_mod_action(
    'sanction.' || p_kind, 'profile', p_user_id::text,
    jsonb_build_object('sanction_id', v_row.id, 'hours', p_hours, 'reason', p_reason)
  );
  return v_row;
end;
$$;
revoke all on function public.issue_sanction(uuid, text, text, integer) from public, anon;
grant execute on function public.issue_sanction(uuid, text, text, integer) to authenticated;

-- Account deletion ----------------------------------------------------------

-- Does this user have anything that must survive deletion for safety reasons?
create or replace function private.needs_safety_hold(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_sanctioned(p_user_id, array['chat_mute', 'suspension', 'ban'])
      or exists (
        select 1 from public.reports r
        where r.status = 'open'
          and r.category in ('under_13', 'urgent')
          and (
            (r.target_type = 'profile' and r.target_id = p_user_id::text)
            or (r.target_type = 'post' and r.target_id in (select id::text from public.posts where author_id = p_user_id))
            or (r.target_type = 'comment' and r.target_id in (select id::text from public.comments where author_id = p_user_id))
            or (r.target_type = 'chat_message' and r.target_id in (select id::text from public.chat_messages where author_id = p_user_id))
          )
      );
$$;

-- Tombstones the profile and either anonymizes or holds the user's content.
-- The caller (server action) deletes the auth user afterwards so the account
-- can no longer sign in. Returns true when a safety hold was applied.
create or replace function private.delete_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold boolean := private.needs_safety_hold(p_user_id);
  v_old_username text;
begin
  select normalized_username into v_old_username from public.profiles where id = p_user_id;
  if v_old_username is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Remember the identity so a later ban check still works.
  insert into public.deleted_identities (user_id_hash, banned)
  values (
    encode(extensions.digest(p_user_id::text, 'sha256'), 'hex'),
    private.is_sanctioned(p_user_id, array['ban'])
  )
  on conflict (user_id_hash) do update set banned = excluded.banned or public.deleted_identities.banned;

  -- Hold the username for 90 days.
  insert into public.username_holds (normalized_username, released_at)
  values (v_old_username, now() + interval '90 days')
  on conflict (normalized_username) do update set released_at = excluded.released_at;

  if v_hold then
    update public.posts set status = 'held' where author_id = p_user_id;
    update public.comments set status = 'held' where author_id = p_user_id;
    update public.chat_messages set status = 'held' where author_id = p_user_id;
  else
    -- Queue uploaded files for purging, then anonymize text content.
    insert into public.deletion_queue (storage_path)
      select storage_path from public.posts where author_id = p_user_id and storage_path is not null
      on conflict do nothing;
    update public.posts set status = 'removed', author_id = null where author_id = p_user_id;
    update public.comments set body = '[deleted]', author_id = null where author_id = p_user_id;
    update public.chat_messages set body = '[deleted]', author_id = null where author_id = p_user_id;
    update public.reports set reporter_id = null where reporter_id = p_user_id;
  end if;

  -- Picks stay in history, detached from the person.
  update public.picks set user_id = null where user_id = p_user_id;

  -- Personal rows go away entirely.
  delete from public.profiles_private where user_id = p_user_id;
  delete from public.recovery_codes where user_id = p_user_id;
  delete from public.blocks where blocker_id = p_user_id or blocked_id = p_user_id;
  delete from public.votes where user_id = p_user_id;
  delete from public.poll_votes where user_id = p_user_id;
  delete from public.user_stats where user_id = p_user_id;
  delete from public.user_badges where user_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;

  update public.profiles
     set username = 'deleted_' || left(replace(p_user_id::text, '-', ''), 8),
         normalized_username = 'deleted_' || left(replace(p_user_id::text, '-', ''), 8),
         favorite_team_id = null,
         status = 'deleted'
   where id = p_user_id;

  return v_hold;
end;
$$;

-- The signed-in user deletes their own account. Returns true if content was
-- held rather than erased, so the UI can say so.
create or replace function public.delete_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return private.delete_user_data(v_uid);
end;
$$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- New private helpers in this file are internal only.
revoke all on function private.log_mod_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.needs_safety_hold(uuid) from public, anon, authenticated;
revoke all on function private.delete_user_data(uuid) from public, anon, authenticated;
