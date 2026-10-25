-- Reference data that production needs too (so it lives in a migration, not seed.sql).

insert into public.app_settings (key, value) values
  ('public_signup_open', 'false'::jsonb),
  ('current_season', '2027'::jsonb);

-- Plain-text team names with app-chosen colors. Deliberately not the clubs'
-- official palettes or marks.
insert into public.teams (id, abbreviation, name, city, league, division, color_primary, color_secondary) values
  (1,  'ARI', 'Diamondbacks', 'Arizona',       'NL', 'West',    '#b23a48', '#e2c044'),
  (2,  'ATL', 'Braves',       'Atlanta',       'NL', 'East',    '#2c4a7f', '#c8422b'),
  (3,  'BAL', 'Orioles',      'Baltimore',     'AL', 'East',    '#e07a1f', '#1d1d1d'),
  (4,  'BOS', 'Red Sox',      'Boston',        'AL', 'East',    '#c0392b', '#1f2d4a'),
  (5,  'CHC', 'Cubs',         'Chicago',       'NL', 'Central', '#1f4e9c', '#d0423b'),
  (6,  'CWS', 'White Sox',    'Chicago',       'AL', 'Central', '#2a2a2a', '#bfc5cc'),
  (7,  'CIN', 'Reds',         'Cincinnati',    'NL', 'Central', '#c8242b', '#1d1d1d'),
  (8,  'CLE', 'Guardians',    'Cleveland',     'AL', 'Central', '#23407a', '#c23a3a'),
  (9,  'COL', 'Rockies',      'Colorado',      'NL', 'West',    '#4b3a7a', '#1d1d1d'),
  (10, 'DET', 'Tigers',       'Detroit',       'AL', 'Central', '#1f2f55', '#e38a2b'),
  (11, 'HOU', 'Astros',       'Houston',       'AL', 'West',    '#1f2f55', '#e3862b'),
  (12, 'KC',  'Royals',       'Kansas City',   'AL', 'Central', '#1f4e9c', '#bfa14a'),
  (13, 'LAA', 'Angels',       'Los Angeles',   'AL', 'West',    '#c0392b', '#1f3a66'),
  (14, 'LAD', 'Dodgers',      'Los Angeles',   'NL', 'West',    '#1e5bb8', '#f4f1ea'),
  (15, 'MIA', 'Marlins',      'Miami',         'NL', 'East',    '#1aa3c9', '#1d1d1d'),
  (16, 'MIL', 'Brewers',      'Milwaukee',     'NL', 'Central', '#1f2f55', '#e2c044'),
  (17, 'MIN', 'Twins',        'Minnesota',     'AL', 'Central', '#1f2f55', '#c8242b'),
  (18, 'NYM', 'Mets',         'New York',      'NL', 'East',    '#1f4e9c', '#e3862b'),
  (19, 'NYY', 'Yankees',      'New York',      'AL', 'East',    '#1f2d4a', '#bfc5cc'),
  (20, 'OAK', 'Athletics',    'Oakland',       'AL', 'West',    '#1f6b4a', '#e2c044'),
  (21, 'PHI', 'Phillies',     'Philadelphia',  'NL', 'East',    '#c8242b', '#1f4e9c'),
  (22, 'PIT', 'Pirates',      'Pittsburgh',    'NL', 'Central', '#2a2a2a', '#e2c044'),
  (23, 'SD',  'Padres',       'San Diego',     'NL', 'West',    '#4a3b2a', '#e2c044'),
  (24, 'SF',  'Giants',       'San Francisco', 'NL', 'West',    '#e07a1f', '#1d1d1d'),
  (25, 'SEA', 'Mariners',     'Seattle',       'AL', 'West',    '#1f4a55', '#2b8a7e'),
  (26, 'STL', 'Cardinals',    'St. Louis',     'NL', 'Central', '#c8242b', '#1f4e9c'),
  (27, 'TB',  'Rays',         'Tampa Bay',     'AL', 'East',    '#1f2f55', '#7ab7e8'),
  (28, 'TEX', 'Rangers',      'Texas',         'AL', 'West',    '#1f4e9c', '#c8242b'),
  (29, 'TOR', 'Blue Jays',    'Toronto',       'AL', 'East',    '#1e5bb8', '#1f2d4a'),
  (30, 'WSH', 'Nationals',    'Washington',    'NL', 'East',    '#b2232c', '#1f2d4a');

insert into public.badges (slug, name, description, repeatable, sort_order) values
  ('rookie_card',    'Rookie Card',    'Made your first pick.',                                          false, 1),
  ('caught_looking', 'Caught Looking', 'Lost a pick you were sure about. Happens to everyone.',          false, 2),
  ('hot_streak',     'Hot Streak',     'Five correct picks in a row.',                                   true,  3),
  ('upset_special',  'Upset Special',  'Called a winner fewer than 30% of fans picked.',                 true,  4),
  ('perfect_game',   'Perfect Game',   'Got every game right on a day with five or more games.',         true,  5),
  ('iron_man',       'Iron Man',       'Made a pick on 30 game days in a row.',                          false, 6),
  ('ace',            'Ace',            'Kept a 70%+ hit rate over 50 picks in a season.',                false, 7);

-- Reserved usernames: staff words, the league, and every club name and
-- abbreviation. Player names are added by U12's word lists.
insert into public.reserved_usernames (normalized, reason)
select distinct lower(w), 'staff' from unnest(array[
  'admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'help',
  'official', 'caughtlooking', 'caught_looking', 'system', 'root', 'team', 'deleted'
]) as w
union all
select distinct lower(w), 'league' from unnest(array[
  'mlb', 'mlb_official', 'mlbofficial', 'majorleaguebaseball', 'baseball', 'umpire', 'commissioner'
]) as w
union all
select lower(abbreviation), 'club' from public.teams
union all
select lower(replace(name, ' ', '')), 'club' from public.teams
union all
select lower(replace(name, ' ', '_')), 'club' from public.teams
on conflict (normalized) do nothing;
