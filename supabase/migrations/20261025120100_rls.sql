-- Row-level security policies (plan U2).
--
-- Clients hold SELECT grants only (see core_schema), so every policy here is a
-- SELECT policy for `authenticated` (or `anon` for public reference data).
-- There are deliberately no INSERT/UPDATE/DELETE policies for client roles:
-- writes happen through security definer RPCs that run their own checks.
-- The service role bypasses RLS.

-- Reference data ------------------------------------------------------------

create policy "teams are public" on public.teams
  for select to anon, authenticated using (true);

create policy "badges are public" on public.badges
  for select to anon, authenticated using (true);

create policy "games are public" on public.games
  for select to anon, authenticated using (true);

-- People --------------------------------------------------------------------

create policy "profiles are visible to members" on public.profiles
  for select to authenticated using (true);

create policy "private profile is owner or admin only" on public.profiles_private
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- Picks and stats -----------------------------------------------------------

-- Your own picks always; everyone's picks once the game has locked. Before
-- lock, other people's picks are invisible so nobody can copy them.
create policy "picks visible to owner, or to all after lock" on public.picks
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.games g
      where g.id = picks.game_id and (g.app_state <> 'open' or now() >= g.lock_at)
    )
  );

create policy "stats are visible to members" on public.user_stats
  for select to authenticated using (true);

create policy "badges earned are visible to members" on public.user_badges
  for select to authenticated using (true);

-- Content -------------------------------------------------------------------

create policy "posts: live to all, own always, staff see hidden" on public.posts
  for select to authenticated
  using (
    status = 'live'
    or author_id = (select auth.uid())
    or (status in ('hidden', 'pending', 'scanning', 'rejected', 'removed') and private.is_staff())
    or private.is_admin()
  );

create policy "comments: live to all, own always, staff see hidden" on public.comments
  for select to authenticated
  using (
    status = 'live'
    or author_id = (select auth.uid())
    or (status in ('hidden', 'removed') and private.is_staff())
    or private.is_admin()
  );

create policy "votes: own only" on public.votes
  for select to authenticated using (user_id = (select auth.uid()));

-- Chat history opens once the game locks and stays readable afterwards.
create policy "chat: live messages of locked or later games" on public.chat_messages
  for select to authenticated
  using (
    (
      status = 'live'
      and exists (
        select 1 from public.games g
        where g.id = chat_messages.game_id and (g.app_state <> 'open' or now() >= g.lock_at)
      )
    )
    or author_id = (select auth.uid())
    or (status in ('hidden', 'removed') and private.is_staff())
    or private.is_admin()
  );

create policy "polls: open and closed to all, hidden to staff" on public.polls
  for select to authenticated
  using (status in ('open', 'closed') or private.is_staff());

create policy "poll options follow their poll" on public.poll_options
  for select to authenticated
  using (exists (
    select 1 from public.polls p
    where p.id = poll_options.poll_id and (p.status in ('open', 'closed') or private.is_staff())
  ));

create policy "poll votes: own only" on public.poll_votes
  for select to authenticated using (user_id = (select auth.uid()));

-- Trust and safety ----------------------------------------------------------

create policy "blocks: own only" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

-- Reporters see their own reports. Mods see ordinary categories. Admins see
-- everything, including under_13 and urgent.
create policy "reports: own, mods ordinary, admins all" on public.reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or private.is_admin()
    or (private.is_staff() and category not in ('under_13', 'urgent'))
  );

-- A sanctioned user sees their own sanction (reason, end date); staff see all.
create policy "sanctions: own or staff" on public.sanctions
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());
