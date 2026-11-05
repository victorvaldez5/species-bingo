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

// A game's list sits in its public folder; Osa's moves from public/ to
// public/osa/ in step 3, and this test runs on either side of the move.
const listFile = game => {
  const cfg = readJson(game);
  const dir = cfg.path.replace(/^\/|\/$/g, '');
  return [`public/${dir}/${cfg.list.file}`, `public/${cfg.list.file}`].find(f => existsSync(path(f)));
};
const pages = [
  { built: 'dist/osa/index.html', game: 'games/osa/game.json' },
  { built: 'dist/moplants/index.html', game: 'games/moplants/game.json' },
];

// Every #id the script queries with $('#id...'), plus the config script.
const bingoSrc = readFileSync(path('public/core/bingo.js'), 'utf8');
const looked = new Set([...bingoSrc.matchAll(/\$\('#([\w-]+)/g)].map(m => m[1]));
looked.add('game-config');
// Ids the script builds from the config rather than writing out.
looked.delete('detail-flag');

for (const { built, game } of pages) {
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
    assert.equal(readJson(listFile(game)).species.length, cfg.list.expected);

    // Share preview tags come from game.json `og`.
    assert.ok(html.includes(`<meta property="og:title" content="${cfg.og.title}">`));
    assert.ok(html.includes(`<meta property="og:description" content="${cfg.og.description}">`));
    assert.ok(html.includes('<meta property="og:type" content="website">'));
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
    assert.ok(html.includes(cfg.og.image), 'og:image');

    // The how-to card matches game.json `howto`, and there is a way back to it.
    assert.ok(html.includes('id="howto"') && html.includes('id="howto-dismiss"') && html.includes('id="howto-open"'));
    for (const step of cfg.howto.steps) assert.ok(html.includes(step));
    if (cfg.howto.offlineLine) assert.ok(html.includes(cfg.howto.offlineLine));
    else assert.ok(!html.includes('howto__off'));
    assert.equal(cfg.howto.steps.length, cfg.cardPair ? 3 : 2, 'step 3 is only for games with a card pair');
    assert.ok(html.includes('href="/how-to-play/"'));

    // The shared footer; the long in-page credits list is gone.
    for (const href of ['/how-to-play/', '/about/', `/credits/#${cfg.id}`, '/privacy/', '/']) {
      assert.ok(html.includes(`<a href="${href}">`), `footer link ${href}`);
    }
    assert.ok(html.includes('class="wnd-logo'), 'maker lockup');
    assert.ok(!html.includes('id="credits"') && !html.includes('credits-list'), 'in-page credits section');
  });
}

test('Only the offline game registers a service worker', () => {
  assert.equal(readJson('games/osa/game.json').offline, true);
  assert.equal(readJson('games/moplants/game.json').offline, false);
});

test('The hub redirects old Osa links before paint and links every game', t => {
  if (!existsSync(path('dist/index.html'))) { t.skip('dist/index.html not found; run `npm run build` first'); return; }
  const html = readFileSync(path('dist/index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  // The redirect is an inline script in <head>, ahead of the stylesheet.
  const redirect = head.indexOf("location.replace('/osa/' + q)");
  assert.ok(redirect > 0, 'redirect script in <head>');
  assert.ok(head.includes("['s', 'c', 'm', 'p']"), 'redirect keys');
  assert.ok(head.includes('display-mode: standalone') && head.includes('navigator.standalone'), 'standalone launch');
  assert.ok(redirect < head.indexOf('rel="stylesheet"'), 'redirect runs before the stylesheet');
  assert.ok(html.includes('og:title" content="Species bingo"') && html.includes('/og/hub.png'));
  for (const g of readJson('games/games.json')) {
    const cfg = readJson(`games/${g.id}/game.json`);
    assert.ok(html.includes(`href="${cfg.path}"`), `hub card for ${g.id}`);
    assert.ok(html.includes(cfg.hub.name) && html.includes(cfg.hub.place.replace(/&/g, '&amp;')));
    assert.equal(cfg.hub.strip.length, 5);
  }
  assert.ok(html.includes('id="continue"') && html.includes('/core/deal.js'));
  for (const href of ['/how-to-play/', '/about/', '/credits/', '/privacy/']) assert.ok(html.includes(`<a href="${href}">`));
  assert.ok(html.includes("register('/sw.js')") && html.includes("register('/osa/sw.js', { scope: '/osa/' })"));
});

test('games.json lists the games in order, each with a game.json', () => {
  assert.equal(readJson('games/osa/game.json').path, '/osa/');
  const list = readJson('games/games.json');
  assert.deepEqual(list.map(g => g.id), ['osa', 'moplants']);
  for (const g of list) {
    const cfg = readJson(`games/${g.id}/game.json`);
    assert.equal(cfg.id, g.id);
    assert.equal(cfg.path, g.path);
  }
});
