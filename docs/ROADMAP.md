# Roadmap: from two games to a presentable site

Goal: something people outside the inner circle can open cold and enjoy,
with room for more bingo lists and, later, other kinds of games. Play only:
no accounts, no backend, progress stays on the phone.

"Presentable" means a stranger can land on the site, understand it, pick a
game and play without hitting rough edges. It does not mean infrastructure
for its own sake.

## Decisions

- **Astro, static output.** It earns its place with the pages a public site
  needs (hub, about, credits, privacy, a page per game) and shared layouts,
  so a fix lands on every game at once. Not Next or Nuxt: no server, no
  framework runtime on the phone.
- **Game logic stays plain JS**, loaded as islands. The hand-rolled service
  worker stays hand-rolled: offline in Corcovado is the feature.
- **Three layers:** `core/` (seed, links, saved progress, menu, drawer,
  offline helpers, tokens), `types/<kind>/` (bingo today), and one data
  folder per game. A new bingo list is data only.
- **Shared links never change meaning.** The deal is pinned by
  `test/deal.test.mjs`. An intentional change to the deal or to a game's
  species order ships as a new deal version in the URL, not in place.

## Steps

0. **Lock what must not change** (done)
   - Golden tests for both games' deals, and a check that the live species
     lists still match the frozen fixtures.
   - CI on every PR: tests, data checks, and generated files up to date.
   - Visual baseline: commit `6712892`. Screenshot both games from it
     (phone width, light and dark) to compare against after step 1.
1. **Astro shell, same games, same URLs.** Move both games into Astro with
   the shared core and bingo type. Done when tests pass, screenshots match
   the baseline and Osa works in airplane mode.
2. **Settings, not copies.** `game.json` per game, `games.json` for the
   list, one set of build scripts, one service worker per game, each scoped
   to its own folder (fixes the "first visit to /moplants shows Osa" bug).
3. **The front door.** A hub at `/` that says what this is and lists the
   games; a short how-to-play on first visit; about, credits and privacy
   pages; share previews (title, image) for links. Move Osa to `/osa/`, with
   the old root worker redirecting installed phones, tested in airplane mode.
4. **Polish pass.** One look across games (dark mode everywhere), friendly
   empty and error states, accessibility (contrast, labels, tap targets,
   reduced motion), and a design review on a real phone.
5. **Nice to have.** A real domain, preview deploys per branch, error
   logging to the Worker logs.
