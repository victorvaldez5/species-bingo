/* The two built pages (Astro output in dist/) must carry the game's inline
   config, load the shared core, and contain every element id that
   public/core/bingo.js looks up. A missing id would only show up as a
   blank page in a browser, so check it here.
   Needs `npm run build` first; skips with a message when dist/ is missing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const path = p => fileURLToPath(new URL(p, ROOT));
const readJson = p => JSON.parse(readFileSync(path(p), 'utf8'));

const pages = [
  { built: 'dist/index.html', game: 'games/osa/game.json', species: 'public/species.json' },
  { built: 'dist/moplants/index.html', game: 'games/moplants/game.json', species: 'public/moplants/species.json' },
];

// Every #id the script queries with $('#id...'), plus the config script.
const bingoSrc = readFileSync(path('public/core/bingo.js'), 'utf8');
const looked = new Set([...bingoSrc.matchAll(/\$\('#([\w-]+)/g)].map(m => m[1]));
looked.add('game-config');
// Ids the script builds from the config rather than writing out.
looked.delete('detail-flag');

for (const { built, game, species } of pages) {
  test(`${built} has the inline config, the core scripts and every id`, t => {
    if (!existsSync(path(built))) {
      t.skip(`${built} not found; run \`npm run build\` first`);
      return;
    }
    const html = readFileSync(path(built), 'utf8');
    const cfg = readJson(game);

    // The inline config is the game's game.json, unchanged.
    const m = html.match(/<script type="application\/json" id="game-config">([\s\S]*?)<\/script>/);
    assert.ok(m, 'inline game-config script not found');
    assert.deepEqual(JSON.parse(m[1]), cfg);

    // Shared core, root-absolute, deal before the app; no per-game copies.
    const deal = html.indexOf('<script src="/core/deal.js"></script>');
    const bingo = html.indexOf('<script src="/core/bingo.js"></script>');
    assert.ok(deal > 0 && bingo > deal, 'core/deal.js must load before core/bingo.js');
    assert.ok(html.includes('<link rel="stylesheet" href="/core/styles.css">'), 'core stylesheet link');
    assert.ok(!/(?:src|href)="(?:app\.js|styles\.css)"/.test(html), 'a per-game app.js/styles.css is still referenced');

    // Dark mode opt-out follows the config.
    assert.equal(html.includes(`<html lang="en" data-scheme="${cfg.scheme}">`), Boolean(cfg.scheme));
    assert.equal(html.includes('<meta name="color-scheme"'), Boolean(cfg.metaColorScheme));

    // Every id the script looks up, plus the ones the config names.
    // (The hunt filters and the below-card list exist only in the games that use them.)
    const ids = new Set(looked);
    ids.add(cfg.detail.callout.id);
    if (cfg.hunt.groupBy !== 'category') ids.delete('hunt-filters');
    if (!cfg.belowCard) ids.delete('safety-list');
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `missing id="${id}"`);
    if (!cfg.belowCard) assert.ok(!html.includes('id="safety-list"'));
    assert.equal(html.includes('id="hunt-filters"'), cfg.hunt.groupBy === 'category');
    for (const mode of cfg.modes) assert.ok(html.includes(`data-mode="${mode.id}"`));
    for (const p of cfg.patterns) assert.ok(html.includes(`data-pattern="${p.key}"`));

    // The list is the size the settings expect.
    assert.equal(readJson(species).species.length, cfg.list.expected);
  });
}

test('Only the offline game registers a service worker', () => {
  assert.equal(readJson('games/osa/game.json').offline, true);
  assert.equal(readJson('games/moplants/game.json').offline, false);
});

test('games.json lists the games in order, each with a game.json', () => {
  const list = readJson('games/games.json');
  assert.deepEqual(list.map(g => g.id), ['osa', 'moplants']);
  for (const g of list) {
    const cfg = readJson(`games/${g.id}/game.json`);
    assert.equal(cfg.id, g.id);
    assert.equal(cfg.path, g.path);
  }
});
