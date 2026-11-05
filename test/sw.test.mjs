/* =============================================================
   The root service worker (public/sw.js) and the hub's launch
   redirect, run against small fakes. These pin the move of Osa from
   "/" to "/osa/" on phones that had the old app installed:
   - the old Osa cache stays until the new one exists, and answers
     Osa offline in the meantime;
   - the hub's strip photos (under the game folders) are served from
     this worker's cache;
   - a game page's own requests are left to the game's worker;
   - only a cold launch of "/" in an installed app goes to /osa/.
   ============================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const path = p => fileURLToPath(new URL(`../${p}`, import.meta.url));
const ORIGIN = 'https://example.test';
const SW_SOURCE = readFileSync(path('public/sw.js'), 'utf8');

// A Cache keyed by absolute URL; ignoreSearch drops the query on both sides.
function fakeCache() {
  const store = new Map();
  const abs = r => new URL(typeof r === 'string' ? r : r.url, `${ORIGIN}/`).href;
  const bare = u => u.split('?')[0];
  return {
    store,
    async match(r, opts = {}) {
      const key = abs(r);
      if (store.has(key)) return store.get(key).clone();
      if (opts.ignoreSearch) for (const [k, v] of store) if (bare(k) === bare(key)) return v.clone();
      return undefined;
    },
    async put(r, res) { store.set(abs(r), res); },
    async addAll() {},
  };
}

function loadWorker({ online = true, cacheNames = [] } = {}) {
  const caches = new Map(cacheNames.map(n => [n, fakeCache()]));
  const listeners = {};
  const network = [];
  const sandbox = {
    self: {
      location: new URL(`${ORIGIN}/sw.js`),
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => [...caches.keys()],
      open: async n => { if (!caches.has(n)) caches.set(n, fakeCache()); return caches.get(n); },
      delete: async n => caches.delete(n),
    },
    fetch: async req => {
      network.push(req.url);
      if (!online) throw new TypeError('offline');
      return new Response(`net:${new URL(req.url).pathname}`, { status: 200 });
    },
    Request, Response, URL, Promise, Boolean,
  };
  vm.runInNewContext(SW_SOURCE, sandbox);

  // Dispatch a fetch event; resolves to the Response, or null if the worker
  // stepped aside (no respondWith).
  async function request(url, { mode = 'no-cors', referrer = '' } = {}) {
    let answer = null;
    const req = { method: 'GET', url: new URL(url, ORIGIN).href, mode, referrer };
    listeners.fetch({ request: req, respondWith: p => { answer = p; } });
    return answer ? await answer : null;
  }
  async function activate() {
    let done;
    listeners.activate({ waitUntil: p => { done = p; } });
    await done;
  }
  return { caches, network, request, activate };
}

const OLD = 'osa-bingo-v2-abc';
const NEW = 'osa-bingo-v3-def';

test('activate keeps the old Osa cache until the new one exists', async () => {
  const w = loadWorker({ cacheNames: [OLD, 'species-bingo-root-v1-old'] });
  await w.activate();
  assert.ok(w.caches.has(OLD), 'old Osa cache kept: it is the only offline copy');
  assert.ok(!w.caches.has('species-bingo-root-v1-old'), 'own old cache removed');

  const moved = loadWorker({ cacheNames: [OLD, NEW] });
  await moved.activate();
  assert.ok(!moved.caches.has(OLD), 'old Osa cache removed once v3 exists');
  assert.ok(moved.caches.has(NEW), 'never touches the new Osa cache');
});

test('offline, Osa with no Osa worker is answered from the old cache', async () => {
  const w = loadWorker({ online: false, cacheNames: [OLD] });
  const old = w.caches.get(OLD);
  await old.put('/', new Response('old osa page'));
  await old.put('/species.json', new Response('old species'));
  await old.put('/img/scarlet-macaw.webp', new Response('old photo'));

  const page = await w.request('/osa/?s=trip&c=2', { mode: 'navigate', referrer: '' });
  assert.equal(await page.text(), 'old osa page');
  const data = await w.request('/osa/species.json', { referrer: `${ORIGIN}/osa/?s=trip` });
  assert.equal(await data.text(), 'old species');
  const photo = await w.request('/osa/img/scarlet-macaw.webp', { referrer: `${ORIGIN}/osa/` });
  assert.equal(await photo.text(), 'old photo');
});

test('online, Osa with no Osa worker goes to the network untouched', async () => {
  const w = loadWorker({ cacheNames: [OLD] });
  const page = await w.request('/osa/', { mode: 'navigate' });
  assert.equal(await page.text(), 'net:/osa/');
  const root = [...w.caches.keys()].find(k => k.startsWith('species-bingo-root-'));
  assert.ok(!root || w.caches.get(root).store.size === 0, 'game files not stored in the root cache');
});

test('the hub strip photos come from this worker\'s cache, offline too', async () => {
  const online = loadWorker();
  const first = await online.request('/osa/img/thumb/scarlet-macaw.webp', { referrer: `${ORIGIN}/` });
  assert.equal(await first.text(), 'net:/osa/img/thumb/scarlet-macaw.webp');

  const w = loadWorker({ online: false });
  const miss = await w.request('/osa/img/thumb/scarlet-macaw.webp', { referrer: `${ORIGIN}/` });
  assert.equal(miss.type, 'error', 'not cached yet, offline: a network error');
  const root = [...w.caches.keys()].find(k => k.startsWith('species-bingo-root-'));
  await w.caches.get(root).put('/osa/img/thumb/scarlet-macaw.webp', new Response('cached thumb'));
  const res = await w.request('/osa/img/thumb/scarlet-macaw.webp', { referrer: `${ORIGIN}/` });
  assert.equal(await res.text(), 'cached thumb');
});

test('a game page\'s own requests are left to the game\'s worker', async () => {
  const w = loadWorker();
  assert.equal(await w.request('/moplants/img/thumb/x.webp', { referrer: `${ORIGIN}/moplants/` }), null);
  assert.equal(await w.request('/moplants/', { mode: 'navigate' }), null);
  assert.equal(await w.request('/core/bingo.js', { referrer: `${ORIGIN}/moplants/?s=a` }), null);
});

test('the hub precaches every game\'s strip photos', () => {
  const block = SW_SOURCE.slice(SW_SOURCE.indexOf('// BEGIN-PRECACHE'), SW_SOURCE.indexOf('// END-PRECACHE'));
  for (const g of JSON.parse(readFileSync(path('games/games.json'), 'utf8'))) {
    const cfg = JSON.parse(readFileSync(path(`games/${g.id}/game.json`), 'utf8'));
    for (const id of cfg.hub.strip) {
      assert.ok(new RegExp(`'${g.id}/[^']*/${id}\\.webp'`).test(block) || block.includes(`'${g.id}/img/${id}.webp'`),
        `${g.id} strip photo ${id} precached`);
    }
  }
});

// ---- The hub's launch redirect -----------------------------------
function runRedirect(script, { search = '', standalone = false, referrer = '' }) {
  let to = null;
  vm.runInNewContext(script, {
    location: { search, replace: u => { to = u; } },
    URLSearchParams,
    window: { matchMedia: () => ({ matches: standalone }) },
    matchMedia: () => ({ matches: standalone }),
    navigator: {},
    document: { referrer },
  });
  return to;
}

test('only a cold launch of "/" in an installed app goes to /osa/', t => {
  if (!existsSync(path('dist/index.html'))) { t.skip('dist/index.html not found; run `npm run build` first'); return; }
  const html = readFileSync(path('dist/index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const script = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("location.replace('/osa/'"));
  assert.ok(script, 'redirect script in <head>');

  assert.equal(runRedirect(script, { search: '?s=trip&c=2' }), '/osa/?s=trip&c=2', 'old link');
  assert.equal(runRedirect(script, { standalone: true }), '/osa/', 'old Osa icon launch');
  assert.equal(runRedirect(script, { standalone: true, referrer: `${ORIGIN}/moplants/` }), null, '"All games" in an installed app');
  assert.equal(runRedirect(script, { standalone: true, search: '?home' }), null, 'hub icon launch');
  assert.equal(runRedirect(script, {}), null, 'browser visit');
});

// The old Osa manifest had no id, so its installs are identified by "/".
// The hub must not claim that id, or Android turns installed Osa icons into
// hub icons that launch /?home instead of the player's card.
test('the hub manifest does not take over old Osa installs', () => {
  const hub = JSON.parse(readFileSync(path('public/manifest.webmanifest'), 'utf8'));
  assert.notEqual(new URL(hub.id, ORIGIN).href, `${ORIGIN}/`);
  assert.equal(new URL(hub.id, ORIGIN).href, new URL(hub.start_url, ORIGIN).href);
});
