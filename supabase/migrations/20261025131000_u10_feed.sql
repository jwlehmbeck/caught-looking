-- U10: feed posts (MLB clip links, news), votes, comments and highlight
-- ingestion.
--
-- Decisions:
--   * Hot ordering is computed at query time inside the feed RPC with the
--     formula from _shared/domain/hot-score.ts:
--         vote_score / power(hours_since_published + 2, 1.5)
--     There is no periodic hot_score sweep; posts.hot_score stays a cached
--     column that the vote trigger refreshes for convenience (indexes,
--     admin views) but the feed never trusts it for ordering.
--   * Paging is offset-based (p_offset) behind a "Load more" button. A
--     Hot order shifts as time passes, so a timestamp cursor would not be
--     any more stable; the page size is small and the table is small.
--   * Writes happen only through security definer RPCs. create_link_post
--     and add_comment are service-only because the server action runs the
--     text filter first; toggle_vote is a member RPC.

-- ---------------------------------------------------------------------------
-- Counters kept by triggers
-- ---------------------------------------------------------------------------

create or replace function private.hot_score_of(p_vote_score integer, p_published_at timestamptz, p_now timestamptz default now())
returns double precision
language sql
immutable
set search_path = ''
as $$
  select p_vote_score::double precision
       / power(greatest(extract(epoch from (p_now - p_published_at)) / 3600.0, 0) + 2, 1.5);
$$;
revoke all on function private.hot_score_of(integer, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.update_hot_score(p_post_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.posts
     set hot_score = private.hot_score_of(vote_score, coalesce(published_at, created_at))
   where id = p_post_id;
$$;
revoke all on function private.update_hot_score(bigint) from public, anon, authenticated;

create or replace function private.votes_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post bigint := coalesce(new.post_id, old.post_id);
begin
  update public.posts p
     set vote_score = (select count(*) from public.votes v where v.post_id = p.id)
   where p.id = v_post;
  perform private.update_hot_score(v_post);
  return null;
end;
$$;
revoke all on function private.votes_counter() from public, anon, authenticated;

create trigger votes_counter
after insert or delete on public.votes
for each row execute function private.votes_counter();

-- comment_count counts live comments only, so hiding one lowers it.
create or replace function private.comments_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post bigint := coalesce(new.post_id, old.post_id);
begin
  update public.posts p
     set comment_count = (select count(*) from public.comments c where c.post_id = p.id and c.status = 'live')
   where p.id = v_post;
  if tg_op = 'UPDATE' and new.post_id is distinct from old.post_id then
    update public.posts p
       set comment_count = (select count(*) from public.comments c where c.post_id = p.id and c.status = 'live')
     where p.id = old.post_id;
  end if;
  return null;
end;
$$;
revoke all on function private.comments_counter() from public, anon, authenticated;

create trigger comments_counter
after insert or update of status, post_id or delete on public.comments
for each row execute function private.comments_counter();

-- One post per link for auto-ingested clips and news. Fan edits have no url.
create unique index if not exists posts_link_url_uidx
  on public.posts (url) where kind in ('mlb_clip', 'news');

-- ---------------------------------------------------------------------------
-- Reading: feed, post detail, comments
-- ---------------------------------------------------------------------------

-- The card rows for the signed-in viewer. Blocked authors are dropped here,
-- so every reader (feed, detail) hides them the same way.
create or replace function private.post_cards(p_viewer uuid)
returns table (
  id                bigint,
  kind              text,
  status            text,
  title             text,
  url               text,
  thumbnail_path    text,
  duration_seconds  smallint,
  team_id           smallint,
  team_abbreviation text,
  team_name         text,
  game_id           bigint,
  author_id         uuid,
  author_username   text,
  vote_score        integer,
  comment_count     integer,
  published_at      timestamptz,
  hot_score         double precision,
  viewer_voted      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.kind, p.status, p.title, p.url, p.thumbnail_path, p.duration_seconds,
         p.team_id, t.abbreviation, t.name,
         p.game_id,
         p.author_id, pr.username,
         p.vote_score, p.comment_count,
         coalesce(p.published_at, p.created_at) as published_at,
         private.hot_score_of(p.vote_score, coalesce(p.published_at, p.created_at)) as hot_score,
         exists (select 1 from public.votes v where v.post_id = p.id and v.user_id = p_viewer) as viewer_voted
    from public.posts p
    left join public.teams t on t.id = p.team_id
    left join public.profiles pr on pr.id = p.author_id
   where p.author_id is null
      or p.author_id = p_viewer
      or not exists (
           select 1 from public.blocks b where b.blocker_id = p_viewer and b.blocked_id = p.author_id
         );
$$;
revoke all on function private.post_cards(uuid) from public, anon, authenticated;

-- The feed. p_tab: hot | new | my_team. Live posts only; my_team uses the
-- viewer's favorite team (empty when they have none).
create or replace function public.feed(p_tab text default 'hot', p_offset integer default 0, p_limit integer default 20)
returns table (
  id                bigint,
  kind              text,
  title             text,
  url               text,
  thumbnail_path    text,
  duration_seconds  smallint,
  team_id           smallint,
  team_abbreviation text,
  team_name         text,
  game_id           bigint,
  author_id         uuid,
  author_username   text,
  vote_score        integer,
  comment_count     integer,
  published_at      timestamptz,
  hot_score         double precision,
  viewer_voted      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_team smallint;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_tab not in ('hot', 'new', 'my_team') then
    raise exception 'unknown tab' using errcode = '22023';
  end if;

  if p_tab = 'my_team' then
    select favorite_team_id into v_team from public.profiles where profiles.id = v_uid;
    if v_team is null then
      return;
    end if;
  end if;

  return query
    select c.id, c.kind, c.title, c.url, c.thumbnail_path, c.duration_seconds,
           c.team_id, c.team_abbreviation, c.team_name, c.game_id,
           c.author_id, c.author_username, c.vote_score, c.comment_count,
           c.published_at, c.hot_score, c.viewer_voted
      from private.post_cards(v_uid) c
     where c.status = 'live'
       and (p_tab <> 'my_team' or c.team_id = v_team)
     order by
       case when p_tab = 'hot' then c.hot_score end desc,
       c.published_at desc,
       c.id desc
     offset v_offset
     limit v_limit;
end;
$$;
revoke all on function public.feed(text, integer, integer) from public, anon;
grant execute on function public.feed(text, integer, integer) to authenticated;

-- One post. Live to everyone (minus blocked authors); the author and staff
-- also see non-live states.
create or replace function public.post_detail(p_post_id bigint)
returns table (
  id                bigint,
  kind              text,
  status            text,
  title             text,
  url               text,
  thumbnail_path    text,
  duration_seconds  smallint,
  team_id           smallint,
  team_abbreviation text,
  team_name         text,
  game_id           bigint,
  author_id         uuid,
  author_username   text,
  vote_score        integer,
  comment_count     integer,
  published_at      timestamptz,
  hot_score         double precision,
  viewer_voted      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return;
  end if;
  return query
    select c.*
      from private.post_cards(v_uid) c
     where c.id = p_post_id
       and (c.status = 'live' or c.author_id = v_uid or private.is_staff());
end;
$$;
revoke all on function public.post_detail(bigint) from public, anon;
grant execute on function public.post_detail(bigint) to authenticated;

-- Live comments on a post, oldest first, minus blocked authors. The viewer
-- also sees their own held (hidden) comments so they know it was stored.
create or replace function public.post_comments(p_post_id bigint)
returns table (
  id          bigint,
  post_id     bigint,
  parent_id   bigint,
  author_id   uuid,
  username    text,
  body        text,
  status      text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.post_id, c.parent_id, c.author_id, pr.username, c.body, c.status, c.created_at
    from public.comments c
    left join public.profiles pr on pr.id = c.author_id
   where c.post_id = p_post_id
     and (select auth.uid()) is not null
     and (c.status = 'live' or (c.status = 'hidden' and c.author_id = (select auth.uid())))
     -- U12's private.is_blocked_by_viewer is created after this migration
     -- runs, so the block check is inlined here.
     and not exists (
       select 1 from public.blocks b
        where b.blocker_id = (select auth.uid()) and b.blocked_id = c.author_id
     )
   order by c.created_at, c.id;
$$;
revoke all on function public.post_comments(bigint) from public, anon;
grant execute on function public.post_comments(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Writing: votes (member), posts and comments (service, after the filter)
-- ---------------------------------------------------------------------------

-- One vote per person per post; voting again removes it.
create or replace function public.toggle_vote(p_post_id bigint)
returns table (vote_score integer, voted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_voted boolean;
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
  if not exists (select 1 from public.posts where id = p_post_id and status = 'live') then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  delete from public.votes where user_id = v_uid and post_id = p_post_id;
  if found then
    v_voted := false;
  else
    insert into public.votes (user_id, post_id) values (v_uid, p_post_id);
    v_voted := true;
  end if;

  return query
    select p.vote_score, v_voted from public.posts p where p.id = p_post_id;
end;
$$;
revoke all on function public.toggle_vote(bigint) from public, anon;
grant execute on function public.toggle_vote(bigint) to authenticated;

-- A member's shared link (MLB.com page or YouTube video). Service only: the
-- server action canonicalizes the URL and filters the title first. The URL
-- shape is checked again here so nothing else can slip in.
create or replace function public.create_link_post(
  p_user_id uuid, p_title text, p_url text, p_team_id smallint default null, p_game_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_id bigint;
begin
  if not private.is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'missing user' using errcode = '22023';
  end if;
  if private.is_sanctioned(p_user_id, array['suspension', 'ban']) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 140 then
    raise exception 'title must be 1 to 140 characters' using errcode = '22023';
  end if;
  if p_url !~ '^https://www\.mlb\.com/[^?#]+$'
     and p_url !~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$' then
    raise exception 'link not allowed' using errcode = '22023';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'unknown team' using errcode = '22023';
  end if;
  if p_game_id is not null and not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'unknown game' using errcode = '22023';
  end if;
  if exists (select 1 from public.posts where url = p_url and kind in ('mlb_clip', 'news')) then
    raise exception 'already shared' using errcode = '23505';
  end if;

  insert into public.posts (author_id, kind, status, title, url, team_id, game_id, published_at)
  values (p_user_id, 'mlb_clip', 'live', v_title, p_url, p_team_id, p_game_id, now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_link_post(uuid, text, text, smallint, bigint) from public, anon, authenticated;
grant execute on function public.create_link_post(uuid, text, text, smallint, bigint) to service_role;

-- A comment, after the server action filtered it: status 'live' (allowed)
-- or 'hidden' (held for staff). Replies stay one level deep (trigger).
create or replace function public.add_comment(
  p_user_id uuid, p_post_id bigint, p_body text, p_parent_id bigint default null, p_status text default 'live'
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.comments;
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
  if private.is_sanctioned(p_user_id, array['suspension', 'ban']) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'no active profile' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'comment must be 1 to 500 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.posts where id = p_post_id and status = 'live') then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.comments where id = p_parent_id and post_id = p_post_id and status = 'live'
  ) then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  insert into public.comments (post_id, author_id, parent_id, body, status)
  values (p_post_id, p_user_id, p_parent_id, v_body, p_status)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.add_comment(uuid, bigint, text, bigint, text) from public, anon, authenticated;
grant execute on function public.add_comment(uuid, bigint, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- Highlight ingestion: games.highlights -> mlb_clip posts (no media stored)
-- ---------------------------------------------------------------------------

-- Creates one live mlb_clip post per MLB.com highlight link stored on the
-- game. Idempotent by url. Returns the number of posts created.
create or replace function private.ingest_highlight_posts(p_game_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games%rowtype;
  h jsonb;
  v_title text;
  v_url text;
  v_team smallint;
  v_created integer := 0;
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;

  select * into g from public.games where id = p_game_id;
  if g.id is null then
    raise exception 'game % does not exist', p_game_id using errcode = 'P0002';
  end if;
  if g.highlights is null or jsonb_typeof(g.highlights) <> 'array' then
    return 0;
  end if;

  v_team := coalesce(g.winner_team_id, g.home_team_id);

  for h in select value from jsonb_array_elements(g.highlights) loop
    if jsonb_typeof(h) <> 'object' then
      continue;
    end if;
    v_title := left(btrim(coalesce(h ->> 'title', '')), 140);
    v_url := btrim(coalesce(h ->> 'url', ''));
    if v_title = '' or v_url !~ '^https://(www\.)?mlb\.com/' then
      continue;
    end if;
    if exists (select 1 from public.posts where url = v_url and kind in ('mlb_clip', 'news')) then
      continue;
    end if;
    insert into public.posts (author_id, kind, status, title, url, team_id, game_id, published_at)
    values (null, 'mlb_clip', 'live', v_title, v_url, v_team, g.id, coalesce(g.ended_at, now()));
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;
revoke all on function private.ingest_highlight_posts(bigint) from public, anon, authenticated;
grant execute on function private.ingest_highlight_posts(bigint) to service_role;

create or replace function public.scorer_ingest_highlights(p_game_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return private.ingest_highlight_posts(p_game_id);
end;
$$;
revoke all on function public.scorer_ingest_highlights(bigint) from public, anon, authenticated;
grant execute on function public.scorer_ingest_highlights(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- News: allow-listed RSS sources -> news posts (headline + link)
-- ---------------------------------------------------------------------------

create table public.news_sources (
  id          smallint generated always as identity primary key,
  name        text not null,
  feed_url    text not null unique check (feed_url ~ '^https://'),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.news_sources is 'Allow-listed RSS/Atom feeds the ingest-news function reads. Service only.';
select private.lock_down('public.news_sources');
grant select on public.news_sources to service_role;

-- MLB.com's own feed is the one enabled source. ESPN and CBS are listed
-- but off: their headlines sometimes carry odds and betting angles, which
-- this app keeps out, so an admin turns them on only after a look.
insert into public.news_sources (name, feed_url, enabled) values
  ('MLB.com News', 'https://www.mlb.com/feeds/news/rss.xml', true),
  ('ESPN MLB', 'https://www.espn.com/espn/rss/mlb/news', false),
  ('CBS Sports MLB', 'https://www.cbssports.com/rss/headlines/mlb/', false)
on conflict (feed_url) do nothing;

-- Stores one news item as a live news post. Idempotent by url; returns
-- true when a post was created.
create or replace function private.ingest_news_item(p_title text, p_url text, p_published_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 140);
  v_url text := btrim(coalesce(p_url, ''));
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if v_title = '' then
    raise exception 'missing title' using errcode = '22023';
  end if;
  if v_url !~ '^https://[^\s]+$' then
    raise exception 'bad url' using errcode = '22023';
  end if;
  if exists (select 1 from public.posts where url = v_url and kind in ('mlb_clip', 'news')) then
    return false;
  end if;
  insert into public.posts (author_id, kind, status, title, url, published_at)
  values (null, 'news', 'live', v_title, v_url, least(coalesce(p_published_at, now()), now()));
  return true;
end;
$$;
revoke all on function private.ingest_news_item(text, text, timestamptz) from public, anon, authenticated;
grant execute on function private.ingest_news_item(text, text, timestamptz) to service_role;

create or replace function public.scorer_ingest_news(p_title text, p_url text, p_published_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return private.ingest_news_item(p_title, p_url, p_published_at);
end;
$$;
revoke all on function public.scorer_ingest_news(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.scorer_ingest_news(text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Cron: ingest-news once an hour. Same guarded pattern as poll-games (U4):
-- needs Vault secrets ingest_news_url and internal_function_secret, and is
-- a no-op where pg_cron / pg_net / vault are missing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping ingest-news schedule';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net not installed; skipping ingest-news schedule';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault not installed; skipping ingest-news schedule';
    return;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ingest_news_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret'' limit 1' into v_secret;
  if v_url is null or v_secret is null then
    raise notice 'vault secrets ingest_news_url / internal_function_secret missing; skipping ingest-news schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'ingest-news';
  perform cron.schedule(
    'ingest-news',
    '17 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_news_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_function_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end;
$$;
