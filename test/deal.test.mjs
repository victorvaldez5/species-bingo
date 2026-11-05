/* =============================================================
   Golden tests for the seeded deal.

   A shared link (?s=<seed>&c=<card>) is only a seed: the card it
   shows is recomputed on the receiving phone. If the PRNG, the
   shuffle or the deal changes, every link already sent silently
   shows a different card. These tests pin today's output so a
   refactor (shared core, Astro) cannot change it by accident.

   The species lists are frozen copies in fixtures/, not the live
   species.json: the deal also depends on the list's order and
   categories, and data edits are a separate decision from code.

   To regenerate after an intentional, versioned change:
     node test/deal.test.mjs --update
   ============================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const readJson = p => JSON.parse(read(p));

// Each app.js is an IIFE with no exports, so evaluate the real source
// of its PRNG + deal section (from xmur3 up to the winning lines) in a
// sandbox. This tests the shipped code, not a copy of it.
function loadDeal(appPath) {
  const src = read(appPath);
  const start = src.indexOf('function xmur3');
  const end = src.indexOf('// Winning lines');
  assert.ok(start > 0 && end > start, `deal section not found in ${appPath}`);
  return vm.runInNewContext(`${src.slice(start, end)}; ({ makeRng, deal })`);
}
// Arrays built in the sandbox have its own Array prototype, which strict
// deep-equal rejects; round-trip to plain arrays of this realm.
const plain = v => JSON.parse(JSON.stringify(v));

const SEEDS = ['a3f2', '0000', 'zzzz', 'k9q1x', 'trip', 'Osa 2026', '1', 'ñandú'];

// Osa: one seed -> a complementary pair of 24-species cards.
function osaCards(seed) {
  const { makeRng, deal } = loadDeal('public/app.js');
  const species = readJson('test/fixtures/osa-species.json');
  return plain(deal(species, makeRng(seed)).map(card => card.map(s => s.id)));
}
// Moplants: one seed -> one card holding every plant.
function moplantsCard(seed) {
  const { deal } = loadDeal('public/moplants/app.js');
  const plants = readJson('test/fixtures/moplants-species.json');
  return plain(deal(plants, seed).map(p => p.id));
}

function compute() {
  return {
    osa: Object.fromEntries(SEEDS.map(s => [s, osaCards(s)])),
    moplants: Object.fromEntries(SEEDS.map(s => [s, moplantsCard(s)])),
  };
}

const GOLDEN = 'test/fixtures/deal-golden.json';

if (process.argv.includes('--update')) {
  writeFileSync(new URL(GOLDEN, root), JSON.stringify(compute(), null, 2) + '\n');
  console.log(`wrote ${GOLDEN}`);
} else {
  const golden = readJson(GOLDEN);

  test('Osa deal matches the pinned cards for every seed', () => {
    for (const seed of SEEDS) assert.deepEqual(osaCards(seed), golden.osa[seed], `seed ${seed}`);
  });

  test('Osa pair is 24 + 24 with no species on both cards', () => {
    for (const seed of SEEDS) {
      const [a, b] = osaCards(seed);
      assert.equal(a.length, 24);
      assert.equal(b.length, 24);
      assert.equal(new Set([...a, ...b]).size, 48, `seed ${seed}`);
    }
  });

  test('Moplants deal matches the pinned card for every seed', () => {
    for (const seed of SEEDS) assert.deepEqual(moplantsCard(seed), golden.moplants[seed], `seed ${seed}`);
  });

  test('Live species lists still match the frozen fixtures', () => {
    // Reordering, adding or recategorizing species changes every shared
    // card. If this fails, the data change needs the same care as a code
    // change: version it, then refresh the fixtures on purpose.
    const pick = list => list.map(({ id, category }) => ({ id, category: category ?? null }));
    assert.deepEqual(pick(readJson('public/species.json').species), readJson('test/fixtures/osa-species.json'));
    assert.deepEqual(pick(readJson('public/moplants/species.json').species), readJson('test/fixtures/moplants-species.json'));
  });
}
