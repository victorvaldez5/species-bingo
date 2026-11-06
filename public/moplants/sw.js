/* =============================================================
   Plant bingo — service worker (scope /moplants/)
   Plant bingo is online-only. This worker exists so the page is
   controlled by its OWN worker and not the Osa one (scope /), whose
   cache-first strategy would serve stale /core/* files after a deploy.

   - Network-first for everything it handles: its own pages, data and
     images under /moplants/, plus the shared /core/*, /tokens.css and
     /fonts/*. Each good response is cached only as a fallback.
   - Offline with no cached copy of a page: a small "needs a
     connection" page, status 503.
   - Cache name moplants-bingo-<BUILD>; BUILD is a content hash written
     by scripts/build-games.mjs. Activate deletes older caches with this
     prefix and never touches any other (Osa's are osa-bingo-*).
   ============================================================= */

const BUILD = 'af10226809';                                 // BUILD (rewritten by build-games)
const PREFIX = 'moplants-bingo-';
const CACHE = `${PREFIX}${BUILD}`;
const SCOPE_PATH = new URL(self.registration.scope).pathname;   // "/moplants/"
const ROOT = new URL('../', self.registration.scope).pathname;  // "/" (or the site subpath)

const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant bingo needs a connection</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5efe3;color:#1f1d18;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
a{color:inherit;font-weight:600}
</style></head><body><main>
<h1>Plant bingo needs a connection</h1>
<p>Check your connection, then try again.</p>
<p><a href="">Try again</a></p>
</main></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Paths this worker answers: the game itself and the shared files it loads.
function handles(url) {
  const p = url.pathname;
  return p.startsWith(SCOPE_PATH) ||
         p.startsWith(`${ROOT}core/`) ||
         p.startsWith(`${ROOT}fonts/`) ||
         p === `${ROOT}tokens.css`;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!handles(url)) return;
  event.respondWith(networkFirst(request));
});
