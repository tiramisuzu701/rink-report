# Rink Report

A personal hockey league site — standings, rosters and stats, playoffs, league
records, news, and an admin-only console for logging games and managing
teams/players/trades. Plain HTML/CSS/JS, no build step, backed by a real
Supabase (Postgres + Auth) database.

## Deploying to GitHub Pages

1. Create a new GitHub repository and push this folder to it:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub, go to the repo's **Settings → Pages**. Under "Build and
   deployment", set **Source** to "Deploy from a branch", pick the `main`
   branch and the `/ (root)` folder, then save.
3. GitHub gives you a URL like `https://<your-username>.github.io/<your-repo>/`
   — the site is live there within a minute or two of each push.

No build step, no environment variables to set in GitHub — the site is
static files that call Supabase directly from the browser.

## The database is already set up

This site is wired to a Supabase project that's already fully configured —
tables, security rules, and one seeded season. You don't need to create or
configure anything in Supabase to start using the site. `js/config.js` holds
the project URL and its **publishable** key; that key is meant to be public
(every Supabase client-side app ships it) — it does not grant write access on
its own. See `supabase/schema.sql` for exactly what's set up, if you're
curious or want to replicate it in your own project later.

## Signing in as admin

The site is read-only to visitors until someone signs in with an
allow-listed email. To log games or manage teams/players:

1. Open the site and click **Admin sign in** in the header.
2. Switch to the **Sign Up** tab, enter `stefanskixavier9@gmail.com` (the
   email that's on the admin allow-list) and choose your own password, then
   submit.
3. Depending on the project's email-confirmation setting, you may need to
   check that inbox and click a confirmation link before your first sign-in
   completes — if so, the panel will tell you to check your email. After
   that, use the **Sign In** tab with the same email and password any time.

Anyone can technically sign up with a different email, but only
`stefanskixavier9@gmail.com` (the address in the `admin_emails` table) is
permitted to write any data — that's enforced by the database itself
(Row Level Security), not by the app, so it holds even if someone bypasses
the UI entirely. Everyone else who signs in just sees the same read-only
site as a signed-out visitor.

To add another admin later (say, a co-manager), open the Supabase
dashboard for this project → SQL Editor, and run:

```sql
insert into public.admin_emails (email) values ('someone-else@example.com');
```

## Project structure

```
index.html          Page shell — loads the Supabase client, then the app
css/styles.css       All styling (light + dark themes)
js/config.js         Supabase project URL + publishable key
js/db.js             Data access layer — maps DB rows <-> app objects
js/app.js            Rendering, routing, forms, and all the app logic
supabase/schema.sql   Reference copy of the database schema + security rules
```

## Notes

- **Points system, team colors, and league name** are all editable from the
  Management tab once you're signed in as admin — nothing is hardcoded.
- **Starting a new season** archives the current one under Records →
  All-Time and gives Standings/Players/Playoffs a clean slate; rosters carry
  over automatically.
- If you ever want to run this against your *own* Supabase project instead
  (a fresh league, fully separate data), create a new Supabase project, run
  `supabase/schema.sql` against it, and update the two values in
  `js/config.js` to that project's URL and publishable key.
