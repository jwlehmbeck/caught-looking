-- Rivalry polls (plan U13). The tables (polls, poll_options, poll_votes) and
-- their read policies come from core_schema/rls. This file adds the write
-- paths and the read RPCs that shape a poll for the screens.
--
-- Rules:
--   * Staff (mods and admins) create polls: question <= 200 chars, 2-4
--     options <= 80 chars each, optional team tags, optional game, a close
--     time. Creation is a service-only RPC because the server action runs
--     the filter pipeline first and then passes the staff user's id.
--   * Regular users vote once. No votes after close, none while suspended
--     or banned.
--   * Results are visible to a viewer only after they voted or the poll
--     closed. Before that the options come back with null counts.
--   * Closing: a poll past `closes_at` is treated as closed on read
--     (active_polls / poll_results / vote_poll all use the same rule), and
--     `close_poll` lets staff close early. There is no scheduled job that
--     flips `status`; `closes_at` is the clock. When staff close early,
--     `closes_at` is pulled back to now() so "closed at" and "recently
--     closed" both read from the one column.

-- ---------------------------------------------------------------------------
-- Shaping a poll for a viewer
-- ---------------------------------------------------------------------------

-- Is this poll closed for voting right now?
create or replace function private.poll_is_closed(p_poll public.polls)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_poll.status <> 'open' or p_poll.closes_at <= now();
$$;
revoke all on function private.poll_is_closed(public.polls) from public, anon, authenticated;

-- One poll as JSON for one viewer. Counts are included only when the viewer
-- has voted or the poll is closed; otherwise every count is null.
create or replace function private.poll_json(p_poll public.polls, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_my_option bigint;
  v_closed boolean := private.poll_is_closed(p_poll);
  v_visible boolean;
  v_total integer;
  v_options jsonb;
  v_team_a jsonb;
  v_team_b jsonb;
begin
  select option_id into v_my_option
    from public.poll_votes
    where poll_id = p_poll.id and user_id = p_viewer;

  v_visible := v_closed or v_my_option is not null;

  select count(*)::integer into v_total from public.poll_votes where poll_id = p_poll.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'label', o.label,
           'sort_order', o.sort_order,
           'count', case when v_visible then coalesce(c.n, 0) else null end
         ) order by o.sort_order), '[]'::jsonb)
    into v_options
    from public.poll_options o
    left join (
      select option_id, count(*)::integer as n
      from public.poll_votes where poll_id = p_poll.id group by option_id
    ) c on c.option_id = o.id
    where o.poll_id = p_poll.id;

  select jsonb_build_object('id', t.id, 'abbreviation', t.abbreviation, 'name', t.name, 'color', t.color_primary)
    into v_team_a from public.teams t where t.id = p_poll.team_a_id;
  select jsonb_build_object('id', t.id, 'abbreviation', t.abbreviation, 'name', t.name, 'color', t.color_primary)
    into v_team_b from public.teams t where t.id = p_poll.team_b_id;

  return jsonb_build_object(
    'id', p_poll.id,
    'question', p_poll.question,
    'status', case when p_poll.status = 'hidden' then 'hidden' when v_closed then 'closed' else 'open' end,
    'closes_at', p_poll.closes_at,
    'created_at', p_poll.created_at,
    'game_id', p_poll.game_id,
    'team_a', v_team_a,
    'team_b', v_team_b,
    'total', case when v_visible then v_total else null end,
    'results_visible', v_visible,
    'my_option_id', v_my_option,
    'options', v_options
  );
end;
$$;
revoke all on function private.poll_json(public.polls, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating polls (service-only: the server action filters the text first)
-- ---------------------------------------------------------------------------

create or replace function public.create_poll(
  p_user_id uuid,
  p_question text,
  p_options text[],
  p_closes_at timestamptz,
  p_team_a smallint default null,
  p_team_b smallint default null,
  p_game_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll_id bigint;
  v_question text := btrim(coalesce(p_question, ''));
  v_option text;
  v_i integer := 0;
  v_seen text[] := '{}';
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from public.user_roles where user_id = p_user_id and role in ('mod', 'admin')
  ) then
    raise exception 'only mods and admins can create polls' using errcode = '42501';
  end if;
  if char_length(v_question) < 1 or char_length(v_question) > 200 then
    raise exception 'question must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_options is null or cardinality(p_options) < 2 or cardinality(p_options) > 4 then
    raise exception 'a poll needs 2 to 4 options' using errcode = '22023';
  end if;
  if p_closes_at is null or p_closes_at <= now() then
    raise exception 'close time must be in the future' using errcode = '22023';
  end if;
  if p_team_a is not null and p_team_b is not null and p_team_a = p_team_b then
    raise exception 'team tags must differ' using errcode = '22023';
  end if;
  if p_game_id is not null and not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'game not found' using errcode = '22023';
  end if;

  foreach v_option in array p_options loop
    v_option := btrim(coalesce(v_option, ''));
    if char_length(v_option) < 1 or char_length(v_option) > 80 then
      raise exception 'each option must be 1 to 80 characters' using errcode = '22023';
    end if;
    if lower(v_option) = any (v_seen) then
      raise exception 'options must be different' using errcode = '22023';
    end if;
    v_seen := v_seen || lower(v_option);
  end loop;

  insert into public.polls (created_by, question, closes_at, team_a_id, team_b_id, game_id)
  values (p_user_id, v_question, p_closes_at, p_team_a, p_team_b, p_game_id)
  returning id into v_poll_id;

  foreach v_option in array p_options loop
    v_i := v_i + 1;
    insert into public.poll_options (poll_id, label, sort_order)
    values (v_poll_id, btrim(v_option), v_i);
  end loop;

  -- auth.uid() is null for the service role, so the actor is passed in.
  insert into public.mod_actions (actor_id, action, target_type, target_id, details)
  values (p_user_id, 'create_poll', 'poll', v_poll_id::text,
          jsonb_build_object('options', cardinality(p_options), 'closes_at', p_closes_at, 'game_id', p_game_id));

  return v_poll_id;
end;
$$;
revoke all on function public.create_poll(uuid, text, text[], timestamptz, smallint, smallint, bigint) from public, anon, authenticated;
grant execute on function public.create_poll(uuid, text, text[], timestamptz, smallint, smallint, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Voting
-- ---------------------------------------------------------------------------

-- One vote per user per poll. Error codes the server action maps to copy:
--   42501  not signed in / suspended / banned
--   P0001  poll is closed (or hidden)
--   22023  option does not belong to this poll
--   23505  already voted
create or replace function public.vote_poll(p_poll_id bigint, p_option_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.polls;
begin
  if v_uid is null then
    raise exception 'sign in to vote' using errcode = '42501';
  end if;
  if private.is_sanctioned(v_uid, array['suspension', 'ban']) then
    raise exception 'your account is suspended' using errcode = '42501';
  end if;

  select * into v_poll from public.polls where id = p_poll_id for share;
  if not found or v_poll.status = 'hidden' then
    raise exception 'poll not found' using errcode = 'P0001';
  end if;
  if private.poll_is_closed(v_poll) then
    raise exception 'this poll is closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'that option is not in this poll' using errcode = '22023';
  end if;

  begin
    insert into public.poll_votes (poll_id, user_id, option_id)
    values (p_poll_id, v_uid, p_option_id);
  exception when unique_violation then
    raise exception 'you already voted in this poll' using errcode = '23505';
  end;

  return private.poll_json(v_poll, v_uid);
end;
$$;
revoke all on function public.vote_poll(bigint, bigint) from public, anon;
grant execute on function public.vote_poll(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff actions
-- ---------------------------------------------------------------------------

create or replace function public.close_poll(p_poll_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'only mods and admins can close polls' using errcode = '42501';
  end if;
  update public.polls
     set status = 'closed', closes_at = least(closes_at, now())
   where id = p_poll_id and status = 'open';
  if not found then
    raise exception 'poll not found or not open' using errcode = 'P0001';
  end if;
  perform private.log_mod_action('close_poll', 'poll', p_poll_id::text, null);
end;
$$;
revoke all on function public.close_poll(bigint) from public, anon;
grant execute on function public.close_poll(bigint) to authenticated;

create or replace function public.hide_poll(p_poll_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'only mods and admins can hide polls' using errcode = '42501';
  end if;
  update public.polls set status = 'hidden' where id = p_poll_id and status <> 'hidden';
  if not found then
    raise exception 'poll not found or already hidden' using errcode = 'P0001';
  end if;
  perform private.log_mod_action('hide_poll', 'poll', p_poll_id::text, null);
end;
$$;
revoke all on function public.hide_poll(bigint) from public, anon;
grant execute on function public.hide_poll(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- One poll with its options; counts only when the viewer voted or it closed.
-- Hidden polls are visible to staff only.
create or replace function public.poll_results(p_poll_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_poll public.polls;
begin
  select * into v_poll from public.polls where id = p_poll_id;
  if not found or (v_poll.status = 'hidden' and not private.is_staff()) then
    return null;
  end if;
  return private.poll_json(v_poll, (select auth.uid()));
end;
$$;
revoke all on function public.poll_results(bigint) from public, anon;
grant execute on function public.poll_results(bigint) to authenticated;

-- Open polls first (soonest to close on top), then polls that closed in the
-- last 24 hours (most recent first). Never hidden ones.
create or replace function public.active_polls(p_limit integer default 5)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.poll_json(p, (select auth.uid()))
    from public.polls p
   where p.status in ('open', 'closed')
     and p.closes_at > now() - interval '24 hours'
   order by private.poll_is_closed(p) asc,
            case when private.poll_is_closed(p) then null else p.closes_at end asc,
            p.closes_at desc,
            p.id desc
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;
revoke all on function public.active_polls(integer) from public, anon;
grant execute on function public.active_polls(integer) to authenticated;

-- Every visible poll tagged to a game, open ones first.
create or replace function public.game_polls(p_game_id bigint)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.poll_json(p, (select auth.uid()))
    from public.polls p
   where p.game_id = p_game_id
     and p.status in ('open', 'closed')
   order by private.poll_is_closed(p) asc, p.closes_at asc, p.id desc;
$$;
revoke all on function public.game_polls(bigint) from public, anon;
grant execute on function public.game_polls(bigint) to authenticated;
