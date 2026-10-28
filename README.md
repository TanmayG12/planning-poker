# Planning poker

Free, open-source planning poker for agile teams, made by Tanmay Gupta. Everyone picks a card in secret, then you flip them together. No accounts, no ads, no per-seat pricing: a static site plus a free Supabase project.

## What it does

- **New game or join.** Start a game with a name, deck and options, then share it with a link or a QR code. Joining takes a code or a pasted invite link.
- **Secret votes.** Other players' cards stay in the database until someone reveals them, so nobody can read them early.
- **One clean flip.** All cards turn over at once. You get the suggested or agreed estimate, the average and the spread, with the lowest and highest votes marked.
- **Who's here.** Each seat shows whether that person is live, away in another tab or offline. Offline players don't block the count or the auto-flip.
- **Stories in, estimates out.** Type stories, paste rows straight from Jira, Excel or Google Sheets, or drop in a CSV or Excel file. Ticket keys and title columns are detected, and duplicates are flagged. Export the results as a CSV that Jira can import.
- **Table options.** Choose from four decks, flip cards automatically when everyone has voted, hide who voted what, run a 2-minute discussion timer, or watch without voting.
- **A little fun.** Nudge someone by tapping their seat, send emoji reactions, and get confetti on a unanimous vote.
- **Themes.** Navy, Crimson, Felt and Slate, each in light, dark or match-device mode, chosen per person. Optional brand packs live outside the repo (see [`brand.example/`](brand.example/)).

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
2. Run the files in [`supabase/migrations/`](supabase/migrations/) in order (0001, 0002, 0003) in the SQL editor, or `supabase link --project-ref <ref>` followed by `supabase db push`.
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
web/                 the app: index.html, styles.css, themes.js (colors), app.js
scripts/build.mjs    copies web/ to dist/, writes config from .env, adds the brand pack
scripts/deploy.mjs   build, then deploy dist/ to Cloudflare Pages
supabase/            database migrations and optional cleanup
brand.example/       template brand pack (copy to brand/)
```

No framework and no bundler. `@supabase/supabase-js` loads from a pinned CDN URL. The Excel reader (SheetJS) and the QR code generator load from pinned CDN URLs only when they're needed.

## Contributing

Issues and pull requests are welcome.

- Keep it buildless and dependency-light, so anyone can fork and deploy it in minutes.
- Database changes go in a new numbered migration. Never edit one that has already shipped.
- Anything that changes what a player can read must keep votes hidden until the reveal.
- New colors go through the theme tokens in `web/themes.js`; don't hard-code them in CSS.

## License

[MIT](LICENSE)
