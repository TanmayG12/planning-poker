# Brand packs

A brand pack gives your own deployment a logo and extra color themes without
putting either in the public repo.

1. Copy this folder to `brand/` at the repo root (`brand/` is git-ignored).
2. Edit `brand.json`. Up to six themes, each with a `light` and a `dark` set.
   Colors are hex values; any token you leave out falls back to Navy.
3. Put your logo next to it (`logo.svg`, optionally `logo-dark.svg`). Use files
   you have the right to use.
4. Run `npm run build` or `npm run deploy`.

Tokens: `page`, `surface`, `ink`, `muted`, `line` (the page), `table`,
`table-2`, `table-ink`, `table-muted`, `rail` (the table), `card`, `card-ink`,
`card-red` (cards), `accent`, `accent-ink` (buttons and highlights), `ok`,
`warn`, `bad`, `focus`, `toast-bg`, `toast-ink`.

Keep text readable: `table-ink` and `table-muted` on `table`, `accent-ink` on
`accent`, and `ink` and `muted` on `page` should each reach 4.5:1.
