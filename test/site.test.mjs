/* The four text pages (Astro output in dist/): each exists with its footer
   and share tags, and the credits page lists every item of both games under
   its own section id. Needs `npm run build` first; skips when dist/ is missing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const path = p => fileURLToPath(new URL(p, ROOT));
const readJson = p => JSON.parse(readFileSync(path(p), 'utf8'));
const built = name => path(`dist/${name}/index.html`);
const unescape = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

for (const name of ['how-to-play', 'about', 'credits', 'privacy']) {
  test(`/${name}/ has a title, share tags and the shared footer`, t => {
    if (!existsSync(built(name))) { t.skip(`dist/${name}/ not found; run \`npm run build\` first`); return; }
    const html = readFileSync(built(name), 'utf8');
    assert.match(html, /<title>[^<]+· Species bingo<\/title>/);
    assert.ok(html.includes('<meta property="og:image" content="/og/hub.png">'));
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
    for (const href of ['/how-to-play/', '/about/', '/credits/', '/privacy/']) {
      assert.ok(html.includes(`<a href="${href}">`), `footer link ${href}`);
    }
    assert.ok(html.includes('class="wnd-logo'), 'maker lockup');
    assert.ok(html.includes('href="/"'), 'back to the hub');
    // The only script is the theme one in <head>; the footer carries the toggle.
    const scripts = html.match(/<script[\s>]/g) || [];
    assert.equal(scripts.length, 1, 'a text page has just the theme script');
    assert.ok(html.slice(0, html.indexOf('</head>')).includes('species-bingo:theme'), 'theme script in <head>');
    for (const choice of ['light', 'dark', 'auto']) assert.ok(html.includes(`data-theme-set="${choice}"`), `footer toggle ${choice}`);
  });
}

test('/credits/ lists every item of both games, each under its own section', t => {
  if (!existsSync(built('credits'))) { t.skip('dist/credits/ not found; run `npm run build` first'); return; }
  const html = unescape(readFileSync(built('credits'), 'utf8'));
  const listFile = cfg => {
    const dir = cfg.path.replace(/^\/|\/$/g, '');
    return [`public/${dir}/${cfg.list.file}`, `public/${cfg.list.file}`].find(f => existsSync(path(f)));
  };
  for (const g of readJson('games/games.json')) {
    const cfg = readJson(`games/${g.id}/game.json`);
    const items = readJson(listFile(cfg)).species;
    assert.ok(html.includes(`<section id="${g.id}"`), `section #${g.id}`);
    for (const item of items) {
      assert.ok(html.includes(`<li id="${g.id}-${item.id}">`), `${g.id}: ${item.id} listed`);
      assert.ok(html.includes(item.name), `${g.id}: ${item.name}`);
      const c = item.credit || {};
      if (c.author && c.license) assert.ok(html.includes(c.author), `${item.id}: author`);
      if (c.source) assert.ok(html.includes(c.source), `${item.id}: source link`);
    }
    // Plant bingo also credits where each fun fact came from.
    if (cfg.credits.withSources) {
      for (const item of items) for (const s of item.sources) assert.ok(html.includes(s.url), `${item.id}: fact source`);
    }
  }
});

test('/how-to-play/ draws a picture for every win pattern', t => {
  if (!existsSync(built('how-to-play'))) { t.skip('dist/how-to-play/ not found; run `npm run build` first'); return; }
  const html = readFileSync(built('how-to-play'), 'utf8');
  const shapes = new Set();
  for (const g of readJson('games/games.json')) for (const p of readJson(`games/${g.id}/game.json`).patterns) shapes.add(p.label);
  for (const label of shapes) assert.ok(html.includes(`<strong>${label}</strong>`), label);
  assert.equal((html.match(/class="shape__mini"/g) || []).length, shapes.size);
});
