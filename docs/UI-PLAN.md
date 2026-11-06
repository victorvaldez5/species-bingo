# UI plan: the presentable site

This plan comes from a design session on 2026-11-05. It drives
[ROADMAP.md](ROADMAP.md) step 3 (front door) and step 4 (polish pass). It
covers the screens and the decisions behind them, not the build order.
Clickable mocks are in [`docs/mocks/`](mocks/index.html). Serve the repo root
and open `docs/mocks/`; they use the real `public/tokens.css`, fonts and
photos.

The hard constraints still apply. Legibility in direct sun beats brand
aesthetics. Marked cells stay solid `--forest` with a cream check in both
themes. `public/tokens.css` stays the base. Osa works offline. Every
existing `?s=<seed>&c=<card>` link keeps its meaning.

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Hub at `/` | It has a one-line pitch, then a card per game: photo strip, name, place, list size, and an offline or needs-signal tag. A **Continue** row appears on top only when this phone has a game in progress. The footer links to How to play, About, Credits and Privacy. |
| D2 | Old Osa URLs | Route by what is asked. `/?s=…` (any params) goes to `/osa/?s=…` with every param kept. A launch from the installed Osa icon (standalone display mode at `/`) goes to `/osa/`, which resumes the last card. Every other visit to `/` gets the hub. The root worker caches the hub, so it opens offline too. |
| D3 | Brand | The Wild & Native Gardens lockup moves to **the footer** of every page as the maker's mark ("made by Wild & Native Gardens"). The top of each page shows only the product or game name. The working site name is **Species bingo** (see open questions). |
| D4 | Game header | A compact top bar: back to hub, game name, Actions. Below it sit the Bingo / Hunt / Race switch and one **status row** with progress, pattern (tap to open a small sheet) and card number (tap to flip). The mode hint text moves into How to play. On a 375×812 phone the card should start at about 25% of the screen height, not 40%. |
| D5 | Per-game freedom | Core fixes the top bar, the Actions menu, the cell look, the banner, the drawer layout and the footer. Each game's `game.json` sets the content: name, place, list, free centre, card pair, modes, patterns, banner wording, which drawer fields appear, offline on or off, and accent colour. A game also gets **one optional section below the card**, which Osa uses for "Keep your distance". |
| D6 | Drawer and banner | These stay as they work today: a bottom sheet with the full photo, name, binomial, ID note, fact, warning, a mark button and the credit; and a stamp banner above the card when you win. They are restyled only for the theme. |
| D7 | First visit | Each game shows a **dismissible how-to card** above the grid on the first visit. It has three short steps plus an offline line, and the buttons More (goes to `/how-to-play`) and Got it. It never covers the card. Dismissal is remembered per game, and Actions → How to play brings it back. |
| D8 | States | Loading shows a **skeleton grid** in the card's exact shape. Errors show **plain-words cards** in the grid's place, each with one button. A missing photo falls back to the name on paper. Details are in the states section below. |
| D9 | Site pages | There are four short pages: `/how-to-play`, `/about`, `/credits` (generated from every game's data, grouped by game) and `/privacy` (about 150 words). The game pages no longer carry the long credits list; instead they get a footer link to `/credits#<game>`. |
| D10 | Share previews | Each game gets one **static 1200×630 image**, built at deploy time: name, place and a photo mosaic. The title reads "Osa wildlife bingo · Species bingo" and the description "Join my card. Tap to play, works offline." Every seed shows the same preview. Per-seed images would need server code, which the roadmap rules out. |
| D11 | Theme | There is **one theme across the site**, in light and dark, with a **single theme button** that steps Auto, Light, Dark (default Auto, follows the phone). The choice is site-wide and saved on the phone. Moplants' semantic tokens (`--bg`, `--surface`, `--text`, …) move into core on top of `tokens.css`. A game may set only an **accent** colour, used for the hub card stripe, a 2px line under the top bar and the preview image. The accent never appears on a marked cell. |

## Pages and screens

### Site map

```
/                 hub                       root worker: cached, offline
/osa/             Osa wildlife bingo        its own worker, fully offline
/moplants/        Plant bingo               online only
/how-to-play      modes, patterns, sharing  cached by root worker
/about            who, why, suggest a list  cached by root worker
/credits          #osa, #moplants           cached by root worker
/privacy          short                     cached by root worker
/?s=…             → /osa/?s=… (redirect, also offline)
```

The root worker is the old Osa worker, reworked. It precaches the hub and
the four text pages (no photos), and it hands off `/?s=` links. The game
workers stay scoped to their own folders, as in roadmap step 2.

### S1 Hub (`/`)

```
┌─────────────────────────────┐
│ Species bingo.              │  forest top bar, product name only
├─────────────────────────────┤
│ Spot it, tap it, get five   │  pitch: what this is, to a stranger
│ in a row. Share the link    │
│ and a friend plays the      │
│ other card.                 │
│ ┌ Continue ───────────────┐ │  only if a game is in progress
│ │ Osa · card 2 · 9/24   › │ │
│ └─────────────────────────┘ │
│ ┌▌────────────────────────┐ │  ▌ = game accent stripe
│ │ [photo strip]           │ │
│ │ Osa wildlife bingo      │ │
│ │ Corcovado, Costa Rica   │ │
│ │ 48 species · ⦿ offline  │ │
│ └─────────────────────────┘ │
│ ┌▌────────────────────────┐ │
│ │ [photo strip]           │ │
│ │ Plant bingo             │ │
│ │ A garden list           │ │
│ │ 25 plants · needs signal│ │
│ └─────────────────────────┘ │
│ How to play · About ·       │
│ Credits · Privacy           │
│ made by WILD & NATIVE       │  lockup lives here (D3)
└─────────────────────────────┘
```

- The game list comes from `games.json`. The Continue row reads each game's
  `…:last` key, the same keys the games already write.
- Offline: the Osa card shows "ready offline" when `/osa/` is in the cache.
  Moplants shows "needs signal" and stays tappable, so the player gets its
  offline state (S8) rather than a dead link.

### S2 Game screen (shared, bingo mode)

```
┌─────────────────────────────┐
│ ‹  Osa wildlife    Actions ▾│  top bar; accent line under it
├─────────────────────────────┤
│ [ Bingo |  Hunt  |  Race  ] │  only modes the game enables
│ 8/24 · Any line ▾ · Card 1 ⇄│  status row
│ ▐ bingo. That is a line.    │  banner, only when won
│ ┌──┬──┬──┬──┬──┐            │
│ │  │██│  │  │  │            │  ██ = solid forest + cream check
│ ├──┼──┼──┼──┼──┤            │
│ │  │  │FR│  │  │            │  free centre if the game has one
│ │  │  │EE│  │  │            │
│ └──┴──┴──┴──┴──┘            │
│ ⚠ Keep your distance        │  optional below-card slot (D5)
│ ─────────────────────────── │
│ How to play · Credits ·     │
│ Privacy · All games         │
│ made by WILD & NATIVE       │
└─────────────────────────────┘
```

- **Status row.** Progress is mono text. "Any line ▾" opens the pattern sheet
  (S3). "Card 1 ⇄" flips the card and appears only when the game has a card
  pair. In Race it reads "Racer 1 ⇄". In Hunt, the pattern and card parts
  hide and progress reads "12 of 48 found".
- **Actions menu** keeps today's items, in this order: Copy link (with
  seed), New card, Reset marks, then a divider, How to play and Theme
  (one row that steps Auto, Light, Dark). New card and Reset stay behind the menu because a
  stray tap on either loses progress.
- **Hunt** keeps the category chips and the list rows. **Race** keeps the
  2×5 board. Both use the same top bar, status row and banner.
- Tap targets are at least 44px, except the cell info button (26px). That
  button sits in a corner away from the main tap area, and the polish pass
  checks it on a real phone.

### S3 Pattern sheet

A small bottom sheet listing each of the game's patterns with a mini 5×5
picture of the shape and the one-line hint that sits on the screen today.
Tapping a pattern selects it and closes the sheet. This keeps four chips and a
hint line off the main screen.

### S4 Detail drawer

This works as today (D6): the full photo, never cropped, then category, name,
binomial, ID note, fact, warning if present, the mark button and the credit.
Fields switch on per game. In Moplants, `photo_note` and `uncertain` use the
warning slot. Only the theme tokens change.

### S5 Bingo banner

This works as today. The stamp word and the message come from `game.json`
`words`, so Osa's "That is the whole peninsula." becomes data.

### S6 First-visit how-to card (D7)

```
┌─────────────────────────┐
│ How to play             │
│ 1 Tap a photo when you  │
│   spot it. Five in a    │
│   row wins.             │
│ 2 ⓘ shows how to ID it. │
│ 3 Share the link: your  │
│   friend gets card 2.   │
│ ⦿ Works offline once    │
│   loaded. Add it to     │
│   your home screen.     │
│        [More] [Got it]  │
└─────────────────────────┘
```

It sits between the status row and the grid, with the card still visible
below. Step 3 appears only when the game has a card pair, and the offline
line only when the game works offline. The card is remembered under
`<game>:howto-seen`. Opening a shared link still shows it, since that is
exactly a stranger's first visit.

### S7 Loading

A skeleton of paper-coloured squares in the grid's shape (5×5, with the
free centre in place), so nothing shifts when the photos arrive. The status
row shows "Dealing your card…".

### S8 Error and empty states (D8)

Each card takes the grid's place, says what happened in plain words and has
one button.

| Case | Message (draft) | Button |
|---|---|---|
| Offline, game not cached | No signal yet. This game hasn't been saved to the phone. Open it once on wifi and it will work offline after that. | Try again |
| Moplants opened offline | This game needs a connection. Osa wildlife bingo works offline. | Try again · Go to Osa |
| Link with a bad or unknown game | That link doesn't match a game here. | All games |
| Storage blocked (private mode) | One line above the card: "Private browsing: your marks won't be kept after you close this tab." It does not block play. | (none) |
| Photo missing | The cell shows the name on paper with no image. The drawer says the photo is coming. | (none) |
| Hunt, nothing found yet | One line above the list: "Tap each species the first time you see it. This list runs the whole trip." | (none) |

### S9 How to play (`/how-to-play`)

This page covers the three modes, the win patterns (with the same mini shape
pictures as S3), how two phones share a seed and get complementary cards,
offline use and add-to-home-screen steps for iOS and Android, and what Reset
and New card do.

### S10 About (`/about`)

This page covers who made it (Wild & Native Gardens), why (field spotting
with friends, on trips), that it is free with no accounts, and how to
suggest a new list.

### S11 Credits (`/credits`)

Generated at build time from every game's data, with one section per game
(`#osa`, `#moplants`). Each species gets its photo author, licence, source
link and fact sources. It replaces the in-page credits `<details>`, while
`CREDITS.md` and `CREDITS-moplants.md` stay as the repo copies.

### S12 Privacy (`/privacy`)

This page says there are no accounts, no tracking and no cookies, and that
nothing is sent anywhere. Progress lives in this browser's local storage and
can be cleared with Reset or by clearing site data. Photos come from the site
itself. If error logging (roadmap step 5) ever ships, this page must change
first.

### S13 Share preview

Each game's `<head>` sets `og:title`, `og:description`, `og:image` (a
1200×630 image built at deploy time) and `twitter:card=summary_large_image`.
The hub has its own image showing both games. Seeds are not reflected in the
preview.

## Theme (D11)

- Core provides the semantic tokens on top of `tokens.css`, starting from
  Moplants' set: `--bg`, `--surface`, `--surface-deep`, `--text`,
  `--text-soft`, `--text-mute`, `--accent-text`, `--brand-text`,
  `--ghost-line`, `--hover`, `--banner-*`. It adds `--game-accent`.
- The toggle sets `data-theme="light|dark"` on `<html>`, or removes the
  attribute for Auto. The choice is stored once under `species-bingo:theme`
  and applied by an inline script in `<head>`, so the page does not flash.
- These stay fixed in both themes: marked cell `--forest` with a cream check,
  the free centre in `--terracotta-deep`, and the line ring in `--sun`.
- Accents: Osa `--sun`, Moplants `--sage`. An accent is decoration only, never
  text and never a state.
- Every pairing gets checked in both themes in the step 4 contrast pass.

## Open questions

1. **Final site name.** "Species bingo" is a working title. It sets the hub
   title, the share titles and the hub's home-screen name.
2. **Install prompt.** Should the hub or the Osa game show an "Add to home
   screen" nudge beyond the how-to line? It matters for offline use but can
   feel pushy.
3. **Drawer next / previous.** Should you be able to swipe between species
   in the drawer? It's nice in Hunt, but it adds a gesture to test.
4. **Moplants copy.** "A garden list" is a placeholder. What is the place or
   owner line for its hub card?
5. **Safety slot on the hub.** Should Osa's "Keep your distance" also appear
   on its hub card, or only on the game screen?
6. **Cell info button size.** At 26px it is under the 44px target. Options are
   to grow it, or to open the drawer on a long-press. Decide on a real phone in
   step 4.
7. **Theme toggle home.** It lives in Actions on game screens. Is the footer
   enough on the hub and the site pages?

## How this maps to the roadmap

- **Step 3 (front door):** S1 hub, D2 routing and the root worker, S6
  first-visit card, S9 to S12 pages, S13 previews.
- **Step 4 (polish):** D4 compact header and S3 pattern sheet, D11 theme
  and toggle, S7 and S8 states, the contrast and tap-target checks, and a
  design review on a real phone against `docs/mocks/`.
