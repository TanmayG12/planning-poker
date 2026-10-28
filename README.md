# Planning poker

Free, open-source planning poker for agile teams. Everyone picks a card in secret, then you flip them together. No accounts, no ads, no per-seat pricing: a static site plus a free Supabase project.

## What it does

**The basics, done properly**
- Live tables. Join with a name and a room code, or send an invite link.
- Votes that are actually secret. Other players' cards stay in the database until someone reveals, so they can't be read from the browser early.
- A simultaneous card flip with consensus, a suggested estimate, the average and the spread.
- Fibonacci, modified Fibonacci, T-shirt and powers-of-2 decks, plus "?" and a coffee-break card. Spectator mode for the Scrum Master or PM.

**The parts that make estimation better**
- **Outliers first.** After a split vote it names the lowest and highest voters and asks the table to hear from them, which is where planning poker earns its keep.
- **Hide who voted what.** Shows the spread without names, so quieter people aren't anchored by senior voices.
- **Split nudge.** When the estimate is big (13+, XL) or half the table picks "?", it suggests splitting the story instead of guessing.
- **Did the re-vote help?** On a second round it compares the new spread with the last one.
- **Your own reference stories.** Pick a card and it reminds you what the team previously estimated at that number.
- **Story queue.** Paste a backlog, one story per line, and Next story pulls them in order.
- **Discussion timer.** A shared 2-minute timer for when a debate starts going in circles.

**The parts that make it fun**
- Flip automatically once everyone has voted.
- Emoji reactions and nudges: tap a teammate's seat to wiggle their cards.
- A little confetti on a unanimous vote.

**After the session**
- A running list with each story's estimate, how many rounds it took and how long.
- Copy a summary for Slack or Teams, or a table for a spreadsheet or Jira.

**Make it yours**
- Two built-in themes, each with light, dark and match-device modes, chosen per person.
- Brand packs: your organization's logo, name and color themes, kept out of the public repo. See [`brand.example/`](brand.example/).

## How it works

```
Browser (static site)                           Supabase (free tier)
─────────────────────                           ────────────────────
signInAnonymously()  ────────────────────────▶  Auth: one anonymous user per browser
rpc('cast_vote'), rpc('reveal_round'), …  ───▶  Postgres functions: check membership, lock the room, write
◀── Realtime: room and player changes ────────  Publication on rooms and players
◀── select votes (after the reveal only) ─────  Row-level security on votes
◀── Realtime presence and broadcast ──────────  Who's here, reactions and nudges
```

- **Votes are readable only after the reveal.** You can read your own vote, and other people's once the round is revealed. "Who's ready" comes from `players.voted_round`, which shows that someone voted without showing what.
- **All writes go through database functions.** No table has insert or update policies. Each function checks that you joined the room and locks the room row, so simultaneous clicks can't leave the table in a broken state.
- **Every room change bumps a version number**, so a late realtime message can't roll the table back.

## Deploy your own

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Run the files in [`supabase/migrations/`](supabase/migrations/) in order in the SQL editor, or `supabase link --project-ref <ref>` followed by `supabase db push`.
3. Under **Authentication**, then **Sign In / Providers**, turn on **Allow anonymous sign-ins**.
4. Under **Project Settings**, then **API Keys**, copy the project URL and the `anon` key.

### 2. Configure

```bash
cp .env.example .env          # then paste in SUPABASE_URL and SUPABASE_ANON_KEY
cp -r brand.example brand     # optional: your logo and themes
npm install
npm run dev                   # http://localhost:8080
```

`.env` and `brand/` are git-ignored, so keys and branding never land in the repo. The anon key is designed to be public anyway; row-level security decides what anyone can do with it.

### 3. Publish

**Cloudflare Pages (recommended).** Free, fast, and deploys straight from your machine, so your local brand pack goes with it:

```bash
npx wrangler login
npx wrangler pages project create planning-poker --production-branch main
npm run deploy
```

**GitHub Pages.** Set repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY`, set **Settings**, then **Pages**, then **Source** to **GitHub Actions**, and push. The included workflow skips itself until those variables exist. It doesn't include a brand pack, since that lives outside the repo.

## Free-tier notes

- **Pausing.** Supabase pauses free projects after about a week without activity. Data is kept; restore the project from the dashboard.
- **Sign-in limits.** Anonymous sign-ins are rate-limited per IP address. Each browser signs in once and keeps its session, so an office behind one IP is usually fine. Raise the limit or add CAPTCHA under **Authentication**, then **Rate Limits**, for a large public instance.
- **Housekeeping.** [`supabase/cleanup.sql`](supabase/cleanup.sql) removes rooms untouched for 30 days and stale anonymous accounts.

## Project layout

```
web/                 the app: index.html, styles.css, themes.js, app.js
scripts/build.mjs    copies web/ to dist/, writes config from .env, adds the brand pack
scripts/deploy.mjs   build, then deploy dist/ to Cloudflare Pages
supabase/            database migrations and optional cleanup
brand.example/       template brand pack (copy to brand/)
```

No framework and no bundler. The one runtime dependency is `@supabase/supabase-js`, loaded from a pinned CDN URL.

## Contributing

Issues and pull requests are welcome.

- Keep it buildless and dependency-light, so anyone can fork and deploy it in minutes.
- Database changes go in a new numbered migration. Never edit one that has already shipped.
- Anything that changes what a player can read must keep votes hidden until the reveal.
- New colors go through the theme tokens in `web/themes.js`; don't hard-code them in CSS.

## License

[MIT](LICENSE)
