# Brand packs

A brand pack gives your own deployment its logo, name and color themes without
putting any of it in the public repo.

1. Copy this folder to `brand/` at the repo root (`brand/` is git-ignored).
2. Edit `brand.json`. Up to six themes; each has a `light` and a `dark` set.
   Colors are hex values. Any token you leave out falls back to the built-in
   card-table theme.
3. Drop your logo files next to it (`logo.svg`, and optionally `logo-dark.svg`
   for dark mode). PNG works too. Use your organization's official files.
4. Run `npm run build` (or `npm run deploy`).

Tokens: `bg`, `surface`, `ink`, `muted`, `line` (page), `felt`, `felt-2`,
`felt-ink`, `felt-muted`, `rail` (the table), `card`, `card-ink`, `card-red`
(cards), `accent`, `accent-ink` (buttons and highlights), `ok`, `warn`, `bad`,
`focus`, `toast-bg`, `toast-ink`.

Keep text readable: `felt-ink` on `felt`, `accent-ink` on `accent` and `ink`
on `bg` should each hit at least 4.5:1 contrast.
