-- Live per-game chat (plan U9).
--
-- The chat_messages table and its read policy come from core_schema/rls.
-- This file adds:
--   * chat_settings            per-game slow mode and a manual close switch
--   * post_chat_message        the only write path (service role, called by
--                              the sendChatMessage server action after the
--                              filter pipeline has run)
--   * chat_history             last 50 live messages, minus blocked authors
--   * chat_window              what the viewer may do right now
--   * set_chat_slow_mode       staff: 10/30/60 s slow mode per game
--   * broadcast triggers       realtime.send to private topic game:{id}
--   * realtime.messages policy subscribe-only for locked-or-later games
--
-- Window rule: chat opens when the game locks (or goes live) and closes 30
-- minutes after the final, after which it is read-only.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.chat_settings (
  game_id            bigint primary key references public.games (id) on delete cascade,
  slow_mode_seconds  integer not null default 10 check (slow_mode_seconds between 10 and 600),
  closed             boolean not null default false,
  updated_at         timestamptz not null default now()
);
comment on table public.chat_settings is 'Per-game chat controls. Absent row means the defaults (10 s slow mode, open).';
select private.lock_down('public.chat_settings');
grant select on public.chat_settings to authenticated;

create policy "chat_settings: staff read" on public.chat_settings
  for select to authenticated
  using (private.is_staff());

-- ---------------------------------------------------------------------------
-- Window helpers
-- ---------------------------------------------------------------------------

-- Is the chat for this game open for new messages (ignoring the viewer)?
-- open     = locked/live/suspended, or final within the last 30 minutes
-- started  = the game has locked at some point (history is readable)
create or replace function private.chat_game_window(p_game_id bigint)
returns table (started boolean, open boolean, exists_ boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(g.app_state <> 'open' or now() >= g.lock_at, false) as started,
    coalesce(
      (
        (g.app_state in ('locked', 'live', 'suspended') or (g.app_state = 'open' and now() >= g.lock_at))
        or (g.app_state in ('final', 'scored')
            and coalesce(g.ended_at, g.updated_at) > now() - interval '30 minutes')
      )
      and not coalesce(s.closed, false),
      false
    ) as open,
    g.id is not null as exists_
  from (select 1) as one
  left join public.games g on g.id = p_game_id
  left join public.chat_settings s on s.game_id = g.id;
$$;
revoke all on function private.chat_game_window(bigint) from public, anon, authenticated;

create or replace function private.chat_slow_mode_seconds(p_game_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select slow_mode_seconds from public.chat_settings where game_id = p_game_id), 10);
$$;
revoke all on function private.chat_slow_mode_seconds(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the viewer may do: drives the chat UI's states
-- ---------------------------------------------------------------------------

create or replace function public.chat_window(p_game_id bigint)
returns table (
  open               boolean,
  read_only          boolean,
  can_send           boolean,
  reason             text,
  slow_mode_seconds  integer,
  unlocks_at         timestamptz,
  sanction_ends_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  w record;
  v_created timestamptz;
  v_sanction record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into w from private.chat_game_window(p_game_id);
  if not w.exists_ then
    return query select false, false, false, 'no_game'::text, 10, null::timestamptz, null::timestamptz;
    return;
  end if;
  if not w.started then
    return query select false, false, false, 'pre_lock'::text, private.chat_slow_mode_seconds(p_game_id), null::timestamptz, null::timestamptz;
    return;
  end if;
  if not w.open then
    return query select false, true, false, 'closed'::text, private.chat_slow_mode_seconds(p_game_id), null::timestamptz, null::timestamptz;
    return;
  end if;

  select s.kind, s.ends_at into v_sanction
    from public.sanctions s
   where s.user_id = v_uid
     and s.kind in ('ban', 'suspension', 'chat_mute')
     and s.lifted_at is null
     and s.starts_at <= now()
     and (s.ends_at is null or s.ends_at > now())
   order by case s.kind when 'ban' then 0 when 'suspension' then 1 else 2 end, s.ends_at desc nulls first
   limit 1;
  if v_sanction.kind is not null then
    return query select true, false, false,
      case v_sanction.kind when 'ban' then 'banned' when 'suspension' then 'suspended' else 'muted' end,
      private.chat_slow_mode_seconds(p_game_id), null::timestamptz, v_sanction.ends_at;
    return;
  end if;

  select created_at into v_created from public.profiles where id = v_uid and status = 'active';
  if v_created is null then
    return query select true, false, false, 'no_profile'::text, private.chat_slow_mode_seconds(p_game_id), null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_created > now() - interval '24 hours' then
    return query select true, false, false, 'account_age'::text, private.chat_slow_mode_seconds(p_game_id),
      v_created + interval '24 hours', null::timestamptz;
    return;
  end if;

  return query select true, false, true, 'ok'::text, private.chat_slow_mode_seconds(p_game_id), null::timestamptz, null::timestamptz;
end;
$$;
revoke all on function public.chat_window(bigint) from public, anon;
grant execute on function public.chat_window(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- History: the last 50 live messages, oldest first, minus blocked authors.
-- Runs as the caller so the chat_messages read policy applies.
-- ---------------------------------------------------------------------------

create or replace function public.chat_history(p_game_id bigint, p_limit integer default 50)
returns table (
  id          bigint,
  game_id     bigint,
  author_id   uuid,
  username    text,
  body        text,
  created_at  timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from (
    select m.id, m.game_id, m.author_id, p.username, m.body, m.created_at
      from public.chat_messages m
      left join public.profiles p on p.id = m.author_id
     where m.game_id = p_game_id
       and m.status = 'live'
       -- Same rule as private.is_blocked_by_viewer (U12), inlined because
       -- that migration is ordered after this one.
       and not exists (
         select 1 from public.blocks b
          where b.blocker_id = (select auth.uid()) and b.blocked_id = m.author_id
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) recent
  order by created_at asc, id asc;
$$;
revoke all on function public.chat_history(bigint, integer) from public, anon;
grant execute on function public.chat_history(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The write path. Service only: the server action runs the filter pipeline
-- first and passes status 'live' (allowed) or 'hidden' (held). Every other
-- rule is enforced here on every send.
-- ---------------------------------------------------------------------------

create or replace function public.post_chat_message(
  p_user_id uuid, p_game_id bigint, p_body text, p_status text default 'live'
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_created timestamptz;
  v_body text := btrim(coalesce(p_body, ''));
  v_slow integer;
  v_last timestamptz;
  v_row public.chat_messages;
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if p_status not in ('live', 'hidden') then
    raise exception 'status must be live or hidden' using errcode = '22023';
  end if;

  select * into w from private.chat_game_window(p_game_id);
  if not w.exists_ then
    raise exception 'no such game' using errcode = 'P0002';
  end if;
  if not w.started then
    raise exception 'chat has not opened' using errcode = 'P0001';
  end if;
  if not w.open then
    raise exception 'chat is closed' using errcode = 'P0001';
  end if;

  if private.is_sanctioned(p_user_id, array['ban']) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if private.is_sanctioned(p_user_id, array['suspension']) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if private.is_sanctioned(p_user_id, array['chat_mute']) then
    raise exception 'muted' using errcode = '42501';
  end if;

  select created_at into v_created from public.profiles where id = p_user_id and status = 'active';
  if v_created is null then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if v_created > now() - interval '24 hours' then
    raise exception 'account too new' using errcode = '42501';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 200 then
    raise exception 'message must be 1 to 200 characters' using errcode = '22023';
  end if;

  v_slow := private.chat_slow_mode_seconds(p_game_id);
  select max(created_at) into v_last
    from public.chat_messages
   where game_id = p_game_id and author_id = p_user_id;
  if v_last is not null and v_last > now() - make_interval(secs => v_slow) then
    raise exception 'slow mode' using errcode = 'P0429';
  end if;

  insert into public.chat_messages (game_id, author_id, body, status)
  values (p_game_id, p_user_id, v_body, p_status)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.post_chat_message(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.post_chat_message(uuid, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Staff: slow mode per game
-- ---------------------------------------------------------------------------

create or replace function public.set_chat_slow_mode(p_game_id bigint, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_seconds is null or p_seconds < 10 or p_seconds > 600 then
    raise exception 'slow mode must be between 10 and 600 seconds' using errcode = '22023';
  end if;
  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'no such game' using errcode = 'P0002';
  end if;

  insert into public.chat_settings (game_id, slow_mode_seconds)
  values (p_game_id, p_seconds)
  on conflict (game_id) do update
    set slow_mode_seconds = excluded.slow_mode_seconds, updated_at = now();

  perform private.log_mod_action(
    'chat.slow_mode', 'game', p_game_id::text, jsonb_build_object('seconds', p_seconds)
  );
end;
$$;
revoke all on function public.set_chat_slow_mode(bigint, integer) from public, anon;
grant execute on function public.set_chat_slow_mode(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Broadcast triggers. realtime.send only exists on Supabase, so the trigger
-- functions look it up at run time and no-op where it is missing (the
-- local pgTAP stand-in). Clients never send on these topics themselves.
-- ---------------------------------------------------------------------------

create or replace function private.chat_broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  if new.status <> 'live' then
    return new;
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return new;
  end if;
  select username into v_username from public.profiles where id = new.author_id;
  execute 'select realtime.send($1, $2, $3, $4)'
    using jsonb_build_object(
            'id', new.id,
            'game_id', new.game_id,
            'author_id', new.author_id,
            'username', v_username,
            'body', new.body,
            'created_at', new.created_at,
            'status', new.status
          ),
          'message',
          'game:' || new.game_id::text,
          true;
  return new;
end;
$$;
revoke all on function private.chat_broadcast_message() from public, anon, authenticated;

create trigger chat_messages_broadcast
after insert on public.chat_messages
for each row execute function private.chat_broadcast_message();

-- When a mod hides a message (hide_content) or deletion holds it, tell the
-- room so connected clients drop it.
create or replace function private.chat_broadcast_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'live' or new.status = 'live' then
    return new;
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return new;
  end if;
  execute 'select realtime.send($1, $2, $3, $4)'
    using jsonb_build_object('id', new.id, 'status', new.status),
          'moderation',
          'game:' || new.game_id::text,
          true;
  return new;
end;
$$;
revoke all on function private.chat_broadcast_moderation() from public, anon, authenticated;

create trigger chat_messages_moderation_broadcast
after update of status on public.chat_messages
for each row execute function private.chat_broadcast_moderation();

-- ---------------------------------------------------------------------------
-- Realtime authorization (Supabase only). Members may SUBSCRIBE to the
-- broadcast topic of a game that has locked or later. There is no insert
-- policy for broadcast, so a client can never send a chat broadcast itself;
-- the only insert allowed is the presence heartbeat that powers "N in chat".
-- realtime.messages already has RLS enabled; never alter it here.
-- ---------------------------------------------------------------------------

create or replace function private.chat_topic_game_id(p_topic text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select nullif(substring(p_topic from '^game:([0-9]{1,18})$'), '')::bigint;
$$;
revoke all on function private.chat_topic_game_id(text) from public, anon;
grant execute on function private.chat_topic_game_id(text) to authenticated;

-- Can the signed-in member open this game's room right now?
create or replace function private.chat_can_subscribe(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.games g
        where g.id = private.chat_topic_game_id(p_topic)
          and (g.app_state <> 'open' or now() >= g.lock_at)
     )
     and not private.is_sanctioned((select auth.uid()), array['ban']);
$$;
revoke all on function private.chat_can_subscribe(text) from public, anon;
grant execute on function private.chat_can_subscribe(text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'realtime' and c.relname = 'messages'
  ) then
    execute $p$
      create policy "chat: members subscribe to locked or later games" on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension in ('broadcast', 'presence')
          and private.chat_can_subscribe(realtime.topic())
        )
    $p$;
    execute $p$
      create policy "chat: members track presence only" on realtime.messages
        for insert to authenticated
        with check (
          realtime.messages.extension = 'presence'
          and private.chat_can_subscribe(realtime.topic())
        )
    $p$;
  end if;
end $$;
