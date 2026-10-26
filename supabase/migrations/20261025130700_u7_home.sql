-- U7: home screen helpers.
--
--   * home_chat_activity   last live chat message time per game, so the home
--                          screen's chat preview can follow the busiest live
--                          game without pulling every message.
--
-- Security invoker: the chat_messages read policy still applies (live
-- messages of locked-or-later games), and the explicit status filter keeps
-- the viewer's own held or hidden messages out of the count.

create or replace function public.home_chat_activity(p_game_ids bigint[])
returns table (game_id bigint, last_message_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.game_id, max(m.created_at) as last_message_at
    from public.chat_messages m
   where m.game_id = any ((coalesce(p_game_ids, '{}'::bigint[]))[1:30])
     and m.status = 'live'
   group by m.game_id;
$$;
revoke all on function public.home_chat_activity(bigint[]) from public, anon;
grant execute on function public.home_chat_activity(bigint[]) to authenticated;
