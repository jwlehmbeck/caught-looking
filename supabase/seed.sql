-- Local development seed. Runs on `npm run db:reset`, never in production.
-- Reference data (teams, badges, settings) lives in migrations.

-- Three sample games "today": one open, one live, one final.
insert into public.games (provider, provider_game_id, season, season_type, official_date, game_date, lock_at, app_state,
                          home_team_id, away_team_id, home_score, away_score, winner_team_id, coded_state, detailed_state)
values
  ('mlb', 'seed-open',  2027, 'regular', current_date, now() + interval '3 hours', now() + interval '3 hours', 'open',
   23, 5, null, null, null, 'S', 'Scheduled'),
  ('mlb', 'seed-live',  2027, 'regular', current_date, now() - interval '1 hour', now() - interval '1 hour', 'live',
   14, 19, 3, 2, null, 'I', 'In Progress'),
  ('mlb', 'seed-final', 2027, 'regular', current_date, now() - interval '5 hours', now() - interval '5 hours', 'final',
   21, 25, 4, 5, 25, 'F', 'Final');

-- One invite code for local testing: FRIENDS-2027 (sha256 of the upper-cased code).
insert into public.invite_codes (code_hash, max_uses, note)
values (encode(extensions.digest('FRIENDS-2027', 'sha256'), 'hex'), 20, 'local dev');
