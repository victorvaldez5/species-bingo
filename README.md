# Osa Peninsula Wildlife Bingo

An offline-capable wildlife bingo web app for field spotting in Corcovado and
Golfo Dulce, Costa Rica. Two players load the same seed and hold complementary
cards. Built as a plain static site (no framework, no bundler) and deployed to
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
npm run manifest     # validate, rewrite the sw.js precache, write CREDITS.md
npm run dev          # wrangler dev — closest to production
```

Then open the printed `http://127.0.0.1:8788`. Other ways to serve `public/`:

```bash
npx serve public                                   # npx ships with Node
python3 -m http.server 8000 --directory public     # no Node needed
```

Service workers only register on a secure context. `http://localhost` and
`http://127.0.0.1` qualify; `file://` does not, so you must **serve** the folder
to test offline. Python can serve `.webmanifest` with the wrong MIME type; if
the install prompt misbehaves, retest with `wrangler dev` or `serve`.

---

## Layout

```
public/                 the deployed directory — nothing else ships
  index.html
  styles.css            imports tokens.css, then app styles
  tokens.css            WFG design tokens (verbatim copy; only @font-face swapped)
  app.js                card generation, marking, offline registration
  sw.js                 hand-rolled service worker (precache list is generated)
  manifest.webmanifest
  species.json          all 48 species + safety callouts — the single source
  _headers              Cloudflare cache rules (the /sw.js no-cache rule matters)
  fonts/                subsetted woff2
  img/                  48 species x (webp + jpg), plus img/icons/
scripts/
  optimize-images.mjs   sharp: raw -> webp + jpg, icons, placeholders
  build-fonts.mjs       subset-font: TTF -> Latin woff2
  build-manifest.mjs    validate + rewrite sw.js precache + write CREDITS.md
img-raw/                git-ignored, raw photo downloads (never deployed)
fonts-src/              git-ignored, brand variable TTFs (never deployed)
wrangler.jsonc
CREDITS.md              generated from species.json
```

`node_modules/`, `scripts/`, `img-raw/` and `fonts-src/` stay out of the upload
because the site lives in `public/`, not the repo root.

---

## Data-driven: `public/species.json`

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
  named `<id>.jpg` (or `.png`/`.webp`), then `npm run images && npm run manifest`.
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
care on the look-alike pairs. No placeholders remain (`public/img/.placeholders.json`
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
4. `npm run images && npm run manifest`.

`build-manifest` hard-fails if a real (non-placeholder) photo is missing its
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

## Offline / PWA

`sw.js` is hand-rolled (~40 lines of logic) because offline *is* the feature and
must stay debuggable:

- Versioned cache `osa-bingo-<major>-<hash>`. The hash is a fingerprint of every
  precached file, written by `build-manifest`, so any changed asset makes a new
  cache and the update actually lands; `<major>` is a manual bump for worker-logic
  changes. `activate` purges old caches.
- On install it precaches the shell, `species.json`, all fonts, all icons and
  **both** formats of all 48 photos (a missing font or format is a silently ugly
  or broken card offline). The precache fetches with `cache: 'reload'` so it
  always stores the current bytes from the network, never a stale copy the
  browser is still holding for that URL (see the immutable trap below).
- Strategy: **cache-first** for images/fonts/static assets, **stale-while-
  revalidate** for the HTML shell and `species.json`.
- `_headers` sets `/sw.js` to `no-cache`. This is not optional: Cloudflare
  edge-caches service workers, and without it clients keep the old worker after
  a deploy and never get new assets.
- `_headers` must **not** mark `/img/*` or `/fonts/*` `immutable`. These
  filenames are stable but their bytes are overwritten in place when a photo is
  swapped, and `immutable` tells the browser to reuse a cached response for a
  year with no revalidation — which stranded old placeholder photos in browsers
  that had visited an earlier deploy (a normal reload showed placeholders; only
  a hard reload, which bypasses the HTTP cache, showed the real photos). They use
  `no-cache` so an unchanged asset costs a 304 and a changed one is picked up.

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

```bash
npm run deploy       # runs `npm run check`, then `wrangler deploy`
```

`wrangler.jsonc` is assets-only: it has `assets.directory` and no `main` / Worker
script. The `deploy` script gates on `npm run check`, so a species missing its
photo fails the deploy instead of failing you in the field. `npm run images` is
**local only** — commit the optimized output; nothing regenerates it remotely.

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

A second, separate game lives in `public/moplants/` (plain-English notes for
the plant list's owner are in `MOPLANTS.md`). It shares only `tokens.css` and
`fonts/` with the Osa app, by relative path, and is otherwise self-contained:
its own `index.html`, `app.js`, `styles.css`, `species.json`, `img/` and
`manifest.webmanifest` (scope `/moplants/`).

- 25 plants, 5 x 5, **no free space**. Every card holds all 25 in a fresh
  shuffle. Order and found marks persist in `localStorage` under
  `moplants-bingo:v1` (theme choice under `moplants-bingo:theme`).
- **Online only, no service worker.** The Osa `sw.js` is scoped to `/`, so it
  explicitly returns early for `/moplants` and `/moplants/*`. Without that,
  a navigation there could fall back to the cached Osa `index.html`.
  `build-manifest.mjs` only reads `public/img/` and the Osa `species.json`,
  so `/moplants` never enters the precache.
- Each plant's fun fact is paraphrased from the URLs in its `sources` array.
  `uncertain` holds a name question still open with the list's owner, and
  `photo_note` says when the photo shows the species or a relative, not the
  exact cultivar. The detail sheet shows both.

```bash
npm run moplants:images    # img-raw/moplants/<id>.jpg -> public/moplants/img/ (full + 240x300 grid thumbs) + icons
npm run moplants:credits   # validate species.json, write CREDITS-moplants.md
npm run moplants:check     # validate only (part of `npm run deploy`)
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
