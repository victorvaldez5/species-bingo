/* =============================================================
   Edge routing (worker/index.js).
   Old Osa links lived at "/?s=...&c=...". The worker sends them to
   /osa/ with the query string untouched; the hub itself passes
   through. ASSETS is faked: the worker only needs a Response.
   ============================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const origin = 'https://example.test';
const run = async path => {
  const hits = [];
  const env = { ASSETS: { fetch: async req => { hits.push(req.url); return new Response('hub', { status: 200 }); } } };
  const res = await worker.fetch(new Request(origin + path), env);
  return { res, hits };
};

// The worker logs one JSON line per open; keep test output quiet.
const quiet = fn => async () => {
  const log = console.log;
  console.log = () => {};
  try { await fn(); } finally { console.log = log; }
};

for (const [from, to] of [
  ['/?s=trip&c=2', '/osa/?s=trip&c=2'],
  ['/?m=hunt', '/osa/?m=hunt'],
  ['/?p=corners&s=a%20b', '/osa/?p=corners&s=a%20b'],
  ['/index.html?s=x', '/osa/?s=x'],
  ['/?home&c=1', '/osa/?home&c=1'],
]) {
  test(`${from} redirects to ${to}`, quiet(async () => {
    const { res, hits } = await run(from);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), to);
    assert.equal(hits.length, 0, 'redirect must not touch the assets');
  }));
}

for (const path of ['/', '/?home', '/index.html', '/?utm_source=x']) {
  test(`${path} passes through`, quiet(async () => {
    const { res, hits } = await run(path);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'hub');
    assert.equal(hits.length, 1);
  }));
}
