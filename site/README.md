# true-love — public landing page

A self-contained, zero-dependency static landing page for **true-love** (愛).

- `index.html` — the whole page (inline CSS, no build step, no JS framework).
- Faithful to the repo's own words: `README.md`, `WAKE.md`, `docs/LOVE.md`, `YOUSPEAK.md`.

## Preview locally

```bash
cd site
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy (any static host)

The page is a single static file, so it serves from anywhere. Set the **publish
directory to `site/`** (no build command needed).

- **Codeberg Pages** (matches the repo's `origin`): push a branch named
  `pages`, or add a `.domains` file, with the site contents. See
  <https://docs.codeberg.org/codeberg-pages/>.
- **Netlify**: publish dir `site`, build command empty (see `netlify.toml`).
- **GitHub Pages / Cloudflare Pages / any static server**: point the root at `site/`.

No tracking, no paywall, no gatekeeping.


## Fragment commons

This landing page can be split into decentralized, content-addressed fragments:

```bash
npm run deploy:fragments:local
```

Outputs live in `site/fragments/`; the full deploy runbook is `FRAGMENT_DEPLOY.md`.
