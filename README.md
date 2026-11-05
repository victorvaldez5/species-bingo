# Osa Peninsula Wildlife Bingo

An offline-capable wildlife bingo web app for field spotting in Corcovado and
Golfo Dulce, Costa Rica. Two players load the same seed and hold complementary
cards. Built as a static site: Astro generates the two HTML pages and everything
else (JS, CSS, service worker, data, images) is plain files, no bundler. Deployed to
**Cloudflare Workers Static Assets**.

**Corcovado has essentially no cell coverage, so offline is the core
requirement, not a nice-to-have.** Load it once on wifi, add it to your home
screen, and it runs fully in airplane mode: HTML, CSS, JS, fonts, `species.json`
and every photo are precached by the service worker.

---

## Quick start

```bash
npm install          # sharp, subset-font, wrangler (dev only)
npm run fonts        # TTF -> subset woff2  (needs fonts-src/, see Fonts)
npm run images       # optimize photos + generate PWA icons + placeholders
npm run build        # Astro pages -> dist/, then validate both games, stamp both service workers, write the CREDITS files
npm run dev          # build, then wrangler dev — closest to production
npm run dev:astro    # Astro dev server (no service worker or _headers)
npm run ci           # lint, build, tests, data checks (CI runs these as build, lint, test)
```

Then open the printed `http://127.0.0.1:8788`. Other ways to serve the built `dist/`:

```bash
npx serve dist                                     # npx ships with Node
python3 -m http.server 8000 --directory dist       # no Node needed
```

Service workers only register on a secure context. `http://localhost` and
`http://127.0.0.1` qualify; `file://` does not, so you must **serve** the folder
to test offline. Python can serve `.webmanifest` with the wrong MIME type; if
the install prompt misbehaves, retest with `wrangler dev` or `serve`.

---

## Layout

```
games/                  one folder of settings per game, plus the list of games
  games.json            id, path and name of every game (Osa, then Plant bingo)
  osa/game.json         everything that makes Osa Osa (see "One core, a settings file per game")
  moplants/game.json    the same for Plant bingo
src/pages/              the two HTML pages (Astro): thin wrappers that pass a game.json to Game.astro
src/components/Game.astro  renders one game from its game.json, inline config included
src/layouts/Page.astro  head, masthead and noscript shared by every game
worker/index.js         the thin Cloudflare Worker: redirects old Osa links, logs page views (see Routing)
astro.config.mjs        static output, no bundling of CSS or JS
dist/                   build output, git-ignored: this is what is deployed
public/                 plain files, copied into dist/ unchanged
  core/deal.js          the seeded deal, storage keys and URL rules (also loaded by the tests)
  core/bingo.js         the game: one script runs any game from its inline config
  core/styles.css       imports tokens.css, then the shared styles (light and dark)
  tokens.css            WFG design tokens (verbatim copy; only @font-face swapped)
  sw.js                 the ROOT (hub) service worker, scope / (precache list is generated)
  manifest.webmanifest  the hub's manifest (start_url /?home)
  icons/                hub icons (copies of Osa's for now)
  og/                   1200x630 share images, made by `npm run og` and committed
  osa/                  Osa's own files, served at /osa/
    sw.js               Osa's hand-rolled offline worker, scope /osa/ (precache list is generated)
    manifest.webmanifest  id and scope /osa/
    species.json        all 48 species + safety callouts — the single source
    img/                48 species x (webp + jpg), plus img/icons/
  moplants/             Plant bingo's own files, served at /moplants/
  _headers              Cloudflare cache rules (the no-cache rules on the workers matter)
  _redirects            old /species.json and /img/* URLs -> /osa/
  fonts/                subsetted woff2
scripts/
  optimize-images.mjs   sharp: raw -> webp + jpg, icons, placeholders
  build-fonts.mjs       subset-font: TTF -> Latin woff2
  build-games.mjs       for every game in games/games.json: validate its list,
                        write its CREDITS file, stamp its worker (Osa's also gets
                        the precache list); also stamps the root worker with the
                        hub and site pages found in dist/. Hashes dist/ pages, so
                        run it via npm run build
  build-og.mjs          sharp: the share images in public/og/ (local only, not in CI)
img-raw/                git-ignored, raw photo downloads (never deployed)
fonts-src/              git-ignored, brand variable TTFs (never deployed)
wrangler.jsonc
CREDITS.md              generated from osa/species.json
```

`node_modules/`, `scripts/`, `img-raw/` and `fonts-src/` stay out of the upload
because only `dist/` is uploaded. Every `<script>` in the pages is `is:inline`, so
Astro bundles nothing. A game's own files (`species.json`, `img/`, `sw.js`,
manifest) are relative URLs; the shared core (`/core/*`) and `/tokens.css` are
root-absolute. `test/html.test.mjs` checks that each built page carries its
inline config, loads the core and contains every element id `bingo.js` looks up.

---

## One core, a settings file per game

Both games run the same code. `public/core/bingo.js` is a plain classic script
(no modules, no bundler) that reads the game's `games/<id>/game.json`, which
`src/components/Game.astro` inlines into the page as
`<script type="application/json" id="game-config">`. Nothing in the core
checks a game id: if two games differ, the difference is a key in `game.json`.

`game.json` holds the page text (title, masthead, colophon, credits wording,
noscript), `offline` and `worker` (the service worker file the page registers,
relative to the page: Osa's offline worker, Plant bingo's network-first one), the list
file with its expected count and noun, `freeCentre`, `cardPair`, the deal and
race strategy names (`stratified-pair`, `shuffle-all`, `shuffle-split`, all in
`core/deal.js`), the modes and win patterns with their wording, how marks are
stored (`storage.marks`: `cells` or `ids`) and when the card number rides in
the link (`urlCard`: `always` or `race`), which photo the grid shows, how Hunt
groups the list, which fields the detail sheet reads, the optional section under
the card (`belowCard`, Osa's "Keep your distance") and the colour scheme
(`scheme: "light"` opts a page out of dark mode).

**To add a game:** add `games/<id>/game.json`, an entry in `games/games.json`, a
page that renders `<Game game={...} />`, and the game's own `species.json`,
`img/` and `manifest.webmanifest`.

**Do not change the deal or the storage rules.** A shared link is only a seed,
and what is saved on a phone is keyed by the namespace and mark format in
`game.json`. `test/deal.test.mjs` pins the cards and race targets, and
`test/storage.test.mjs` pins the keys and query strings. Changing any of them
needs a versioned migration, not an edit.

---

## Data-driven: `public/osa/species.json`

Nothing about a species lives in the markup or JS. Each entry:

```json
{
  "id": "scarlet-macaw",
  "name": "Scarlet Macaw",
  "binomial": "Ara macao",
  "category": "bird",
  "photo": "img/scarlet-macaw",
  "id_note": "what actually distinguishes it in the field",
  "fun_fact": "one line",
  "credit": { "author": "", "license": "", "source": "", "status": "unsourced" }
}
```

- `photo` is the extensionless stem; the app appends `.webp` / `.jpg` for `<picture>`.
- Categories: `mammal`, `bird`, `reptile`, `amphibian`, `invertebrate`, `plant`, `marine`.
- **To add or swap a species:** edit `species.json`, drop a photo into `img-raw/`
  named `<id>.jpg` (or `.png`/`.webp`), then `npm run images && npm run build`.
  Nothing else.

`species.json` also holds a `safety` array (see Safety below).

---

## Card generation

- The pool is exactly 48 species. A card is 24 species plus a FREE center.
- **One seed generates the complete pair.** The 48 are partitioned into two
  non-overlapping 24s and each is dealt into fixed grid positions, so two people
  on the same seed hold complementary cards (card 1 and card 2).
- Deterministic PRNG: **xmur3** hashes the seed string, **mulberry32** generates.
  Pure integer math, so the same seed yields the same cards in every browser.
- The deal is **stratified**: within each category, species go to whichever card
  currently holds fewer, so neither card ends up all mammals or all crabs, and
  the split always lands at exactly 24 / 24.
- The seed rides in the URL (`?s=a3f2&c=1`). No seed means a fresh one is
  generated and pushed into the URL so the card is immediately linkable. "New
  card" makes a new seed; the card toggle flips between the complementary pair.
- Marked cells persist in `localStorage`, keyed by **seed + card number**, with a
  per-card reset. A completed line (row, column or diagonal) is detected and
  announced.

---

## Photos

**Current status: all 48 species carry real, licensed photos.** Every image was
sourced from Wikimedia Commons (including Commons-hosted iNaturalist and Flickr
uploads) under a public-domain, CC0, CC BY or CC BY-SA license, matched to the
species by **binomial** and verified by eye against the field-ID notes, with extra
care on the look-alike pairs. No placeholders remain (`public/osa/img/.placeholders.json`
is empty). Per-photo attribution lives in each species' `credit` block in
`species.json` and is regenerated into `CREDITS.md`.

Two notes on identity worth keeping:

- **Blue Morpho** uses a live, open-wing _Morpho helenor_ (peleides form) so the
  electric blue that names it actually shows; the wings-closed brown underside is
  accurate but unrecognizable on a grid.
- **Whimbrel** is the American **Hudsonian Whimbrel** (_Numenius hudsonicus_), the
  bird that actually reaches the Osa, not the white-rumped Eurasian _N. phaeopus_.

To swap or add a photo later:

1. Find a **public-domain or CC-licensed** image (Wikimedia Commons, iNaturalist
   CC-BY/CC0, Flickr Creative Commons). No all-rights-reserved images.
2. Save it as `img-raw/<id>.jpg` (matching the species `id`).
3. Fill that species' `credit` block in `species.json` (`author`, `license`,
   `source`; remove `status`). Attribution is a **legal requirement** on a public
   CC-BY site, and it renders in the app and in `CREDITS.md`.
4. `npm run images && npm run build`.

`build-games` hard-fails if a real (non-placeholder) photo is missing its
credit. If no decently licensed photo exists for a species, **flag it rather
than substituting a lookalike** — a mislabeled fer-de-lance is a safety problem,
not a cosmetic one.

---

## Fonts

The brand ships ~1.9 MB of variable TTFs across six files. `build-fonts.mjs`
converts them to Latin-subset woff2, keeping the variable weight axes and
dropping faces this app does not use (JetBrains Mono ships roman only, no
italic).

**Final shipped total: ~281 KB across 5 files** (Playfair roman + italic, Nunito
Sans, Caveat, JetBrains Mono), comfortably under the 400 KB target.

Source TTFs are read from `fonts-src/` (git-ignored). Copy the brand's variable
TTFs there, or point `FONTS_SRC` at the design system's `fonts/` directory.

---

## Routing

| URL | What |
|---|---|
| `/` | the hub (game picker) |
| `/osa/`, `/moplants/` | the two games |
| `/how-to-play/`, `/about/`, `/credits/`, `/privacy/` | site pages |

Osa used to live at `/`, so every link ever shared looks like `/?s=trip&c=2`
(keys `s`, `c`, `m`, `p`). Those still work, twice over:

- **At the edge**, `worker/index.js` (it runs only for `/` and `/index.html`)
  answers any request carrying one of those keys with a `302` to `/osa/` plus
  the original query string, untouched.
- **In the browser**, the hub page does the same in an inline script before it
  paints, which covers the offline and cached case, and also sends an installed
  old Osa icon (launches at `/` in standalone mode) on to `/osa/`.
- `public/_redirects` sends the old `/species.json` and `/img/*` to `/osa/...`
  for any old cached page that is still online.

The hub's manifest starts at `/?home`, which is deliberately not redirected, so
an installed hub opens the hub.

---

## Offline / PWA

There are three hand-rolled workers (kept readable because offline *is* the
feature and must stay debuggable). Each stamps its own `BUILD` content hash via
`build-games`, so any changed asset makes a new cache and the update lands;
`VERSION` in each file is a manual bump for worker-logic changes.

- **`/osa/sw.js`** (scope `/osa/`, cache `osa-bingo-v3-<hash>`) is Osa's offline
  worker. On install it precaches the page, `species.json`, its manifest and
  icons, **both** formats of all 48 photos, and the shared core, tokens and
  fonts as root-absolute URLs (a missing font or format is a silently ugly or
  broken card offline). The precache fetches with `cache: 'reload'` so it always
  stores the current bytes from the network, never a stale copy the browser is
  still holding for that URL (see the immutable trap below). Strategy:
  **cache-first** for images/fonts/static assets, **stale-while-revalidate** for
  the page and `species.json`. `activate` purges older `osa-bingo-v3-*` caches.
- **`/sw.js`** (scope `/`, cache `species-bingo-root-<major>-<hash>`) is the
  hub's worker. It precaches the hub and the site pages that exist in `dist/`,
  the shared styles, fonts, manifest and icons; pages are stale-while-revalidate
  (falling back to the cached hub), other same-origin GETs are cache-first at
  runtime (the hub's photo strip). It steps aside for anything under `/osa/` or
  `/moplants/`, and for sub-requests made by those pages. This is the same URL
  the old root-scoped Osa worker had, so installed copies update into it, and its
  `activate` deletes the old `osa-bingo-v2-*` cache. The hub registers
  `/osa/sw.js` itself when it sees a returning Osa player, so they keep offline
  play after that cleanup.
- **`/moplants/sw.js`** is Plant bingo's network-first worker (no precache).
- `_headers` sets every worker (`/sw.js`, `/osa/sw.js`, `/moplants/sw.js`) to
  `no-cache`. This is not optional: Cloudflare edge-caches service workers, and
  without it clients keep the old worker after a deploy and never get new assets.
- `_headers` must **not** mark `/osa/img/*` or `/fonts/*` `immutable`. These
  filenames are stable but their bytes are overwritten in place when a photo is
  swapped, and `immutable` tells the browser to reuse a cached response for a
  year with no revalidation — which stranded old placeholder photos in browsers
  that had visited an earlier deploy (a normal reload showed placeholders; only
  a hard reload, which bypasses the HTTP cache, showed the real photos). They use
  `no-cache` so an unchanged asset costs a 304 and a changed one is picked up.
- Share images (`public/og/*.png`) are generated locally with `npm run og`
  (needs sharp) and committed; CI does not run it.

### Verify offline for real (do this on a phone before the trip)

1. `npm run dev` (or deploy) and open the app in Chrome/Safari over wifi.
2. Add to Home Screen. Open the installed app once so the worker installs.
3. Turn on **airplane mode**.
4. Hard-reload / relaunch. Confirm the card layout, every photo, the fonts and
   your marked state all survive, and that "New card" and card-flip still work.

An untested service worker is the default failure mode of this kind of project,
so treat step 4 as required, outdoors, not just on a desk.

---

## Deploy (Cloudflare Workers Static Assets)

**Merging to `main` deploys.** The CI workflow (`.github/workflows/ci.yml`)
runs build, lint and test on every PR and push; on `main` only, a deploy job
runs `npm run build` and `wrangler deploy` once all three pass. It needs the repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. GitHub Actions is the only
deployer: Cloudflare Workers Builds must not also deploy `main`.

By hand, as a fallback:

```bash
npm run deploy       # runs `npm run ci` (lint, build, tests, data checks), then `wrangler deploy`
```

Both paths gate on the data checks, so a species missing its photo fails the
deploy instead of failing you in the field. `npm run images` is **local only**:
commit the optimized output; nothing regenerates it remotely.

---

## Safety

Dangerous species are shown as prominent callouts, not sought as bingo targets.
**Fer-de-lance** and **bullet ant** are not in the 48-species pool and appear
only in the safety callouts. **White-lipped Peccary**, **American Crocodile** and
**Spectacled Caiman** are legitimate spot-from-a-safe-distance targets, so they
remain on the card *and* are flagged in the safety callouts and in their own
detail sheets. All of this is data in `species.json` (`safety` array plus a
per-species `safety` note).

---

## Design system

Built on **Wild & Native Gardens**. `tokens.css` is a verbatim copy of the
brand's `colors_and_type.css` (only the `@font-face` sources are swapped to the
subsetted woff2); re-copy it wholesale if the brand changes. Copy is written to
the brand's `voice.md` rules (warm and flowing, no emoji, no em-dashes, no
exclamation marks, sentence case).

This card is read one-handed in direct equatorial sun, so where brand aesthetics
and legibility conflict, legibility wins: marked cells use a solid `--forest`
fill with a cream check (never a tint or hue alone), and small text uses
`--terracotta-deep` (7.6:1), never plain `--terracotta` (AA-Large only). Every
foreground/background pairing the app uses was checked against the WCAG math in
the design system's `contrast_check.html`; all pass AA, most AAA.

---

## Plant Bingo at `/moplants`

A second game lives in `public/moplants/` (its page is `src/pages/moplants/index.astro`,
its settings `games/moplants/game.json`; plain-English notes for the plant
list's owner are in `MOPLANTS.md`). It shares the core, `tokens.css` and
`fonts/` with Osa, and owns its `species.json`, `img/` and
`manifest.webmanifest` (scope `/moplants/`).

- **Same UX as Osa, same code.** It runs the shared core (`/core/bingo.js`,
  `/core/styles.css`) with its own `games/moplants/game.json`, so a component
  change lands in both games. Surfaces and text go through semantic tokens, so
  Plant bingo also has a system-driven dark mode; Osa is pinned to light
  (`"scheme": "light"`) for now.
- 25 plants, 5 x 5, **no free space**, no card pair. A seed (`?s=`, same
  xmur3 + mulberry32 deal as Osa) puts all 25 in a deterministic order, so a
  copied link reproduces the card. Spotted plant ids persist per seed in
  `localStorage` under `moplants-bingo:v2:<seed>`, last seed under
  `moplants-bingo:v2:last`. "New card" is a new seed, so it needs no confirm.
- **Online only, with its own network-first worker.** `public/moplants/sw.js`
  (scope `/moplants/`) fetches the network first for its pages, data, images and
  the shared `/core/*`, `/tokens.css` and `/fonts/*`, caching each good response
  only as a fallback; offline with no cached page it shows a small "needs a
  connection" page (503). Its cache is `moplants-bingo-<hash>`; `activate`
  deletes older ones with that prefix and never touches Osa's `osa-bingo-*`.
  It exists because the Osa worker (scope `/`) is cache-first: with only that
  worker, a deploy gave Plant bingo new HTML but old cached core files. The
  longest scope wins, so once registered this worker controls `/moplants/`.
  For the very first visit, before it registers, the Osa worker also steps
  aside for `/moplants` pages and for any request whose referrer is under
  `/moplants/`. `build-games.mjs` stamps the worker's hash and commits it like
  Osa's, and CI diffs it. Nothing under `/moplants/` enters Osa's precache.
- Each plant's fun fact is paraphrased from the URLs in its `sources` array.
  `uncertain` holds a name question still open with the list's owner, and
  `photo_note` says when the photo shows the species or a relative, not the
  exact cultivar. The detail sheet shows both.

```bash
npm run moplants:images    # img-raw/moplants/<id>.jpg -> public/moplants/img/ (full + 300x300 grid thumbs) + icons
npm run build              # validates the list, writes CREDITS-moplants.md, stamps the worker
npm run check              # validate only, both games (part of `npm run deploy`)
```

---

## Verified in this build

- Determinism, exact 24 / 24 split, and fully complementary cards across 500
  seeds and repeated runs.
- Marking, per-(seed, card) persistence across reload, line detection, the
  detail sheet and the safety callouts.
- Every color pairing meets WCAG AA (most AAA).
- Fonts subset to ~281 KB.
- Service worker: all 111 precache assets return 200, `sw.js` installs all of
  them and serves them with the network down (simulated). **The live
  airplane-mode test on a device is still yours to run — see above.**
```
