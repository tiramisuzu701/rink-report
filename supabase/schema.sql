-- Rink Report — Supabase schema
-- ================================
-- This file documents the exact schema and Row Level Security setup that
-- is already applied to the live project this site talks to (see
-- js/config.js for the project URL/key). You do NOT need to run this to
-- use the site — it's here for reference / version control, and as a
-- starting point if you ever want to stand up your own separate project.
--
-- Applied as three migrations: initial_league_schema, then
-- rls_and_admin_allowlist, then add_divisions.

-- ---------- Core tables ----------

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null default current_date,
  is_current boolean not null default false,
  points_win integer not null default 2,
  points_otl integer not null default 1,
  points_loss integer not null default 0,
  created_at timestamptz not null default now()
);

-- Divisions group teams (e.g. "North" / "South") and optionally carry a
-- playoff cutoff: the number of teams from that division that make the
-- playoffs. Divisions persist across seasons, same as teams.
create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  playoff_cutoff integer, -- null = no cutoff line shown for this division
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  abbr text,
  color_primary text default '#1D5D8C',
  active boolean not null default true,
  division_id uuid references public.divisions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  position text not null default 'F' check (position in ('F','D','G')),
  jersey integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  date date not null,
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  home_score integer not null default 0,
  away_score integer not null default 0,
  result text check (result in ('REG','OT','SO')),
  status text not null default 'scheduled' check (status in ('scheduled','final')),
  is_playoff boolean not null default false,
  playoff_series_id uuid, -- FK added below, after playoff_series exists
  notes text,
  created_at timestamptz not null default now()
);

create table public.game_player_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id),
  team_id uuid references public.teams(id),
  is_goalie boolean not null default false,
  goals integer not null default 0,
  assists integer not null default 0,
  goals_against integer not null default 0
);

create table public.news (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'general' check (type in ('trade','announcement','general')),
  title text not null,
  body text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.playoff_brackets (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  seed_count integer not null,
  best_of integer not null,
  champion_team_id uuid references public.teams(id),
  created_at timestamptz not null default now()
);

create table public.playoff_series (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references public.playoff_brackets(id) on delete cascade,
  round integer not null,
  match_number integer not null,
  seed_a integer,
  seed_b integer,
  team_a_id uuid references public.teams(id),
  team_b_id uuid references public.teams(id),
  best_of integer not null,
  wins_a integer not null default 0,
  wins_b integer not null default 0,
  winner_id uuid references public.teams(id),
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  next_series_id uuid references public.playoff_series(id),
  next_series_slot text check (next_series_slot in ('A','B'))
);

alter table public.games
  add constraint games_playoff_series_fk
  foreign key (playoff_series_id) references public.playoff_series(id);

create table public.settings (
  id boolean primary key default true check (id), -- single-row table
  league_name text not null default 'My Hockey League',
  tagline text
);

insert into public.settings (id, league_name) values (true, 'My Hockey League');
insert into public.seasons (name, is_current) values ('Season 1', true);
insert into public.news (type, title, body) values ('announcement', 'Welcome to Rink Report', 'The site is live.');

-- ---------- Admin allow-list + Row Level Security ----------
-- Anyone can sign up (standard Supabase Auth). Whether a signed-in user can
-- WRITE anything is decided entirely server-side by this allow-list — not
-- by anything the client sends. Add or remove admins by editing this table
-- from the Supabase dashboard's SQL editor (Table Editor works too).

create table public.admin_emails (
  email text primary key
);
-- No RLS policies are created for admin_emails, so it is invisible to and
-- unwritable by every client (including signed-in admins) — only reachable
-- via the SQL editor / service_role, and via is_admin() below.
alter table public.admin_emails enable row level security;

insert into public.admin_emails (email) values ('stefanskixavier9@gmail.com');
-- To add another admin later, run:
--   insert into public.admin_emails (email) values ('someone-else@example.com');

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_emails
    where email = (auth.jwt() ->> 'email')
  );
$$;

-- Every data table: world-readable, admin-only writable.
do $$
declare
  t text;
begin
  foreach t in array array['seasons','teams','players','games','game_player_stats','news','playoff_brackets','playoff_series','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%I public read" on public.%I for select using (true)', t, t);
    execute format('create policy "%I admin write" on public.%I for insert with check (is_admin())', t, t);
    execute format('create policy "%I admin update" on public.%I for update using (is_admin()) with check (is_admin())', t, t);
    execute format('create policy "%I admin delete" on public.%I for delete using (is_admin())', t, t);
  end loop;
end $$;

-- ---------- add_divisions migration (applied after the above) ----------
-- (divisions and teams.division_id are created earlier in this file so the
-- table order reads top-to-bottom; RLS for divisions follows the same
-- public-read / admin-write pattern as every other table.)

alter table public.divisions enable row level security;
create policy "divisions public read" on public.divisions for select using (true);
create policy "divisions admin write" on public.divisions for insert with check (is_admin());
create policy "divisions admin update" on public.divisions for update using (is_admin()) with check (is_admin());
create policy "divisions admin delete" on public.divisions for delete using (is_admin());
