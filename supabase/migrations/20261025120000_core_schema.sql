-- Caught Looking: core schema (plan U2).
--
-- Rules this file follows (see docs/plans and AGENTS.md):
--   * Authenticated users can only READ. Every write goes through a
--     security definer RPC or a service-role function.
--   * Every table has RLS enabled and its write grants revoked from clients.
--   * Personal data (birth year, recovery state) lives in profiles_private.
--   * Games are provider-neutral: internal id + (provider, provider_game_id).

create extension if not exists pgcrypto with schema extensions;

-- Policies run as the client role and call helper functions in `private`,
-- so clients need USAGE on the schema. Which functions they may execute is
-- decided function by function at the end of each migration.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Revokes client write access and enables RLS. Call it for every new table,
-- because Supabase's default privileges would otherwise grant clients full
-- access to anything created later.
create or replace function private.lock_down(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('revoke all on table %s from public, anon, authenticated', p_table);
  execute format('alter table %s enable row level security', p_table);
end;
$$;

create or replace function private.is_service()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin');
$$;

-- ---------------------------------------------------------------------------
-- Settings and reference data
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
comment on table public.app_settings is 'Feature flags and launch gates. public_signup_open is flipped by U14.';
select private.lock_down('public.app_settings');

create table public.teams (
  id              smallint primary key,
  abbreviation    text not null unique check (abbreviation ~ '^[A-Z]{2,3}$'),
  name            text not null,
  city            text not null,
  league          text not null check (league in ('AL', 'NL')),
  division        text not null check (division in ('East', 'Central', 'West')),
  color_primary   text not null check (color_primary ~ '^#[0-9a-f]{6}$'),
  color_secondary text not null check (color_secondary ~ '^#[0-9a-f]{6}$')
);
comment on table public.teams is 'Plain-text team names and app-chosen colors. No logos, ever.';
select private.lock_down('public.teams');
grant select on public.teams to anon, authenticated;

create table public.badges (
  slug        text primary key,
  name        text not null,
  description text not null,
  repeatable  boolean not null default false,
  sort_order  smallint not null
);
select private.lock_down('public.badges');
grant select on public.badges to anon, authenticated;

create table public.reserved_usernames (
  normalized  text primary key check (normalized = lower(normalized)),
  reason      text not null
);
comment on table public.reserved_usernames is 'Names nobody may register: MLB, club and player names, staff words.';
select private.lock_down('public.reserved_usernames');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('mod', 'admin')),
  granted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table public.user_roles is 'Roles live here, never in user_metadata.';
select private.lock_down('public.user_roles');

create or replace function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = p_role
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select private.has_role('admin');
$$;

create or replace function private.is_staff()
returns boolean language sql stable set search_path = '' as $$
  select private.has_role('admin') or private.has_role('mod');
$$;

-- The profile row is a tombstone after deletion (status = 'deleted'), so it
-- deliberately does NOT cascade from auth.users.
create table public.profiles (
  id                   uuid primary key,
  username             text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  normalized_username  text not null unique check (normalized_username ~ '^[a-z0-9_]{3,20}$'),
  favorite_team_id     smallint references public.teams (id),
  status               text not null default 'active' check (status in ('active', 'deleted')),
  created_at           timestamptz not null default now()
);
comment on column public.profiles.normalized_username is 'Lower-cased, lookalike-folded form produced by the filter pipeline. Uniqueness is checked here.';
select private.lock_down('public.profiles');
grant select on public.profiles to authenticated;

create table public.profiles_private (
  user_id                  uuid primary key references public.profiles (id) on delete cascade,
  birth_year               smallint not null check (birth_year between 1900 and 2100),
  age_verified_13_plus     boolean not null default true,
  team_changed_season      smallint,
  deleted_at               timestamptz,
  recovery_failed_attempts smallint not null default 0,
  recovery_locked_until    timestamptz
);
comment on table public.profiles_private is 'Owner- and admin-only personal data. Never joined into public views.';
select private.lock_down('public.profiles_private');
grant select on public.profiles_private to authenticated;

create table public.recovery_codes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  primary key (user_id, created_at)
);
comment on table public.recovery_codes is 'Hashed recovery codes (argon2/bcrypt). Only the newest unused one is valid.';
select private.lock_down('public.recovery_codes');

create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,
  created_by  uuid references auth.users (id) on delete set null,
  max_uses    integer not null default 1 check (max_uses > 0),
  used_count  integer not null default 0 check (used_count >= 0),
  expires_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  check (used_count <= max_uses)
);
select private.lock_down('public.invite_codes');

create table public.username_holds (
  normalized_username text primary key,
  released_at         timestamptz not null
);
comment on table public.username_holds is 'Usernames of deleted accounts, unavailable until released_at (90 days).';
select private.lock_down('public.username_holds');

-- ---------------------------------------------------------------------------
-- Games and picks
-- ---------------------------------------------------------------------------

create table public.games (
  id                bigint generated always as identity primary key,
  provider          text not null default 'mlb',
  provider_game_id  text not null,
  season            smallint not null,
  season_type       text not null check (season_type in ('spring', 'regular', 'allstar', 'postseason', 'other')),
  counts_for_picks  boolean generated always as (season_type in ('regular', 'postseason')) stored,
  official_date     date not null,
  game_date         timestamptz not null,
  start_time_tbd    boolean not null default false,
  coded_state       text,
  detailed_state    text,
  app_state         text not null default 'open'
                    check (app_state in ('open', 'locked', 'live', 'suspended', 'final', 'scored', 'void')),
  lock_at           timestamptz not null,
  home_team_id      smallint not null references public.teams (id),
  away_team_id      smallint not null references public.teams (id),
  home_score        smallint,
  away_score        smallint,
  winner_team_id    smallint references public.teams (id),
  double_header     text not null default 'N' check (double_header in ('N', 'Y', 'S')),
  game_number       smallint not null default 1,
  rescheduled_from  date,
  resume_date       date,
  ended_at          timestamptz,
  final_score_hash  text,
  lock_split        jsonb,
  highlights        jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, provider_game_id),
  check (home_team_id <> away_team_id)
);
comment on column public.games.lock_split is 'Snapshot of pick counts per team taken at lock; feeds Upset Special.';
comment on column public.games.final_score_hash is 'Hash of the final linescore; the scorer''s idempotency key.';
create index games_official_date_idx on public.games (official_date);
create index games_app_state_idx on public.games (app_state);
select private.lock_down('public.games');
grant select on public.games to anon, authenticated;

create table public.picks (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  game_id     bigint not null references public.games (id) on delete cascade,
  team_id     smallint not null references public.teams (id),
  status      text not null default 'active' check (status in ('active', 'correct', 'wrong', 'void')),
  picked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, game_id)
);
comment on column public.picks.user_id is 'Null after account deletion: the pick stays in history, detached.';
create index picks_game_idx on public.picks (game_id);
select private.lock_down('public.picks');
grant select on public.picks to authenticated;

-- Changing a pick after lock is impossible no matter who asks, except the
-- service role updating status when it scores or voids a game.
create or replace function private.picks_lock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g public.games%rowtype;
begin
  select * into g from public.games where id = new.game_id;
  if g.id is null then
    raise exception 'game % does not exist', new.game_id using errcode = '23503';
  end if;

  if tg_op = 'INSERT' or new.team_id is distinct from old.team_id or new.game_id is distinct from old.game_id then
    if g.app_state <> 'open' or now() >= g.lock_at then
      raise exception 'picks for this game are locked' using errcode = 'P0001';
    end if;
    if new.team_id not in (g.home_team_id, g.away_team_id) then
      raise exception 'team is not playing in this game' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and not private.is_service() then
    raise exception 'only the scorer may change pick status' using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger picks_lock_guard
before insert or update on public.picks
for each row execute function private.picks_lock_guard();

-- season = 0 holds the lifetime totals.
create table public.user_stats (
  user_id              uuid not null references public.profiles (id) on delete cascade,
  season               smallint not null,
  picks_scored         integer not null default 0,
  picks_correct        integer not null default 0,
  current_streak       integer not null default 0,
  best_streak          integer not null default 0,
  game_day_streak      integer not null default 0,
  last_pick_game_date  date,
  updated_at           timestamptz not null default now(),
  primary key (user_id, season)
);
select private.lock_down('public.user_stats');
grant select on public.user_stats to authenticated;

create table public.user_badges (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  badge_slug    text not null references public.badges (slug),
  times_earned  integer not null default 1 check (times_earned >= 1),
  first_earned  timestamptz not null default now(),
  last_earned   timestamptz not null default now(),
  last_game_id  bigint references public.games (id) on delete set null,
  primary key (user_id, badge_slug)
);
select private.lock_down('public.user_badges');
grant select on public.user_badges to authenticated;

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

-- Content status vocabulary shared by posts, comments and chat_messages:
--   pending/scanning  uploads not yet approved (posts only)
--   live              visible to everyone
--   hidden            hidden by a mod, visible to staff
--   removed           removed by an admin or the author, visible to admins
--   rejected          upload rejected (posts only), visible to author + staff
--   held              under a safety/legal hold after account deletion; admins only

create table public.posts (
  id                bigint generated always as identity primary key,
  author_id         uuid references public.profiles (id) on delete set null,
  kind              text not null check (kind in ('mlb_clip', 'fan_edit', 'news')),
  status            text not null check (status in ('pending', 'scanning', 'live', 'hidden', 'removed', 'rejected', 'held')),
  title             text not null check (char_length(title) between 1 and 140),
  url               text check (url is null or url ~ '^https://'),
  storage_path      text,
  thumbnail_path    text,
  duration_seconds  smallint check (duration_seconds is null or duration_seconds between 1 and 60),
  team_id           smallint references public.teams (id),
  game_id           bigint references public.games (id) on delete set null,
  vote_score        integer not null default 0,
  comment_count     integer not null default 0,
  hot_score         double precision not null default 0,
  rejection_reason  text check (rejection_reason is null or rejection_reason in ('copyright', 'personal_info', 'contact_info', 'off_topic', 'quality', 'unsafe')),
  scan_job_id       text,
  created_at        timestamptz not null default now(),
  published_at      timestamptz,
  check ((kind = 'fan_edit') = (storage_path is not null)),
  check ((kind <> 'fan_edit') = (url is not null))
);
create index posts_feed_idx on public.posts (status, hot_score desc, created_at desc);
create index posts_team_idx on public.posts (team_id, created_at desc);
create index posts_author_idx on public.posts (author_id);
select private.lock_down('public.posts');
grant select on public.posts to authenticated;

create table public.comments (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.posts (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  parent_id   bigint references public.comments (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  status      text not null default 'live' check (status in ('live', 'hidden', 'removed', 'held')),
  created_at  timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
select private.lock_down('public.comments');
grant select on public.comments to authenticated;

-- Replies stay one level deep.
create or replace function private.comments_one_level()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.comments where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'replies can only be one level deep' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger comments_one_level before insert or update on public.comments
for each row execute function private.comments_one_level();

create table public.votes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  post_id     bigint not null references public.posts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);
select private.lock_down('public.votes');
grant select on public.votes to authenticated;

create table public.chat_messages (
  id          bigint generated always as identity primary key,
  game_id     bigint not null references public.games (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 200),
  status      text not null default 'live' check (status in ('live', 'hidden', 'removed', 'held')),
  created_at  timestamptz not null default now()
);
create index chat_messages_game_idx on public.chat_messages (game_id, created_at desc);
select private.lock_down('public.chat_messages');
grant select on public.chat_messages to authenticated;

create table public.polls (
  id          bigint generated always as identity primary key,
  created_by  uuid references public.profiles (id) on delete set null,
  question    text not null check (char_length(question) between 1 and 200),
  status      text not null default 'open' check (status in ('open', 'closed', 'hidden')),
  closes_at   timestamptz not null,
  team_a_id   smallint references public.teams (id),
  team_b_id   smallint references public.teams (id),
  game_id     bigint references public.games (id) on delete set null,
  created_at  timestamptz not null default now()
);
select private.lock_down('public.polls');
grant select on public.polls to authenticated;

create table public.poll_options (
  id          bigint generated always as identity primary key,
  poll_id     bigint not null references public.polls (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 80),
  sort_order  smallint not null,
  unique (poll_id, sort_order)
);
select private.lock_down('public.poll_options');
grant select on public.poll_options to authenticated;

create table public.poll_votes (
  poll_id     bigint not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  option_id   bigint not null references public.poll_options (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (poll_id, user_id)
);
select private.lock_down('public.poll_votes');
grant select on public.poll_votes to authenticated;

-- ---------------------------------------------------------------------------
-- Trust and safety
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
select private.lock_down('public.blocks');
grant select on public.blocks to authenticated;

create table public.reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid references public.profiles (id) on delete set null,
  target_type  text not null check (target_type in ('post', 'comment', 'chat_message', 'profile', 'poll')),
  target_id    text not null,
  category     text not null check (category in ('spam', 'bullying', 'inappropriate', 'contact_info', 'under_13', 'urgent')),
  details      text check (details is null or char_length(details) <= 500),
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
comment on column public.reports.category is 'under_13 and urgent are admin-only; mods never see them.';
create index reports_queue_idx on public.reports (status, target_type, target_id);
select private.lock_down('public.reports');
grant select on public.reports to authenticated;

create table public.sanctions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('chat_mute', 'suspension', 'ban')),
  reason      text not null check (char_length(reason) between 1 and 500),
  issued_by   uuid references public.profiles (id) on delete set null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  lifted_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index sanctions_user_idx on public.sanctions (user_id, kind);
select private.lock_down('public.sanctions');
grant select on public.sanctions to authenticated;

create or replace function private.is_sanctioned(p_user_id uuid, p_kinds text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sanctions
    where user_id = p_user_id
      and kind = any (p_kinds)
      and lifted_at is null
      and starts_at <= now()
      and (ends_at is null or ends_at > now())
  );
$$;

create table public.mod_actions (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    text not null,
  details      jsonb,
  created_at   timestamptz not null default now()
);
comment on table public.mod_actions is 'Append-only audit log of every mod and admin action.';
select private.lock_down('public.mod_actions');

create table public.deleted_identities (
  user_id_hash  text primary key,
  banned        boolean not null default false,
  deleted_at    timestamptz not null default now()
);
comment on table public.deleted_identities is 'Hashed ids of deleted accounts so deletion cannot lift a ban.';
select private.lock_down('public.deleted_identities');

create table public.deletion_queue (
  storage_path  text primary key,
  queued_at     timestamptz not null default now()
);
comment on table public.deletion_queue is 'Fan-edit files to purge from storage after their account was deleted.';
select private.lock_down('public.deletion_queue');

-- ---------------------------------------------------------------------------
-- Function permissions: nothing in `private` is callable by clients except
-- the read-only helpers that policies need.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_role(text) to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_service() to anon, authenticated;
grant execute on function private.is_sanctioned(uuid, text[]) to authenticated;
