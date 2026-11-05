/* =============================================================
   Pins what is already saved on people's phones and in sent links:
   the localStorage keys, the shape of what is stored, and the query
   strings. The rules live in public/core/deal.js (BingoKeys) and are
   driven by each game's game.json, so this test reads the real
   game.json files rather than a copy.

   If one of these assertions has to change, saved cards or shared
   links stop matching. That needs a versioned migration, not an edit.
   ============================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const readJson = p => JSON.parse(read(p));

// deal.js reads URLSearchParams from the global; a bare vm context has none.
const sandbox = { URLSearchParams };
vm.runInNewContext(read('public/core/deal.js'), sandbox);
const K = sandbox.BingoKeys;
const plain = v => JSON.parse(JSON.stringify(v));

const osa = readJson('games/osa/game.json');
const mo = readJson('games/moplants/game.json');

test('Osa keys', () => {
  assert.equal(K.marks(osa, 'a3f2', 1), 'osa-bingo:v1:a3f2:c1');
  assert.equal(K.marks(osa, 'a3f2', 2), 'osa-bingo:v1:a3f2:c2');
  assert.equal(K.last(osa), 'osa-bingo:v1:last');
  assert.equal(K.hunt(osa), 'osa-bingo:v1:hunt');
  assert.equal(K.race(osa, 'a3f2', 2), 'osa-bingo:v1:a3f2:r2');
  assert.equal(K.raceEnd(osa, 'a3f2', 2), 'osa-bingo:v1:a3f2:r2:end');
});

test('Moplants keys', () => {
  assert.equal(K.marks(mo, 'a3f2', 1), 'moplants-bingo:v2:a3f2');
  assert.equal(K.marks(mo, 'a3f2', 2), 'moplants-bingo:v2:a3f2');
  assert.equal(K.last(mo), 'moplants-bingo:v2:last');
  assert.equal(K.hunt(mo), 'moplants-bingo:v2:hunt');
  assert.equal(K.race(mo, 'a3f2', 1), 'moplants-bingo:v2:a3f2:r1');
  assert.equal(K.raceEnd(mo, 'a3f2', 1), 'moplants-bingo:v2:a3f2:r1:end');
});

test('Storage formats in the settings', () => {
  // Osa stores cell indices (12 is FREE); Moplants stores plant ids.
  assert.equal(osa.storage.marks, 'cells');
  assert.equal(osa.freeCentre, true);
  assert.equal(mo.storage.marks, 'ids');
  assert.equal(mo.freeCentre, false);
});

test('Last-card record', () => {
  // Osa: absent is null; junk that is not JSON is null too.
  assert.equal(K.parseLast(osa, null), null);
  assert.equal(K.parseLast(osa, 'abc1'), null);
  const rec = { seed: 'a3f2', card: 2, mode: 'race', pattern: 'x' };
  assert.deepEqual(plain(K.parseLast(osa, JSON.stringify(rec))), rec);
  assert.deepEqual(plain(K.parseLast(mo, JSON.stringify(rec))), rec);
  // Moplants once saved the bare seed string, and that must still load.
  assert.deepEqual(plain(K.parseLast(mo, 'abc1')), { seed: 'abc1' });
  assert.deepEqual(plain(K.parseLast(mo, null)), { seed: '' });
});

const st = (seed, card, mode, pattern) => ({ seed, card, mode, pattern });

test('Osa writes the card (c) in every mode', () => {
  assert.equal(K.writeQuery(osa, '', st('a3f2', 1, 'bingo', 'line')), 's=a3f2&c=1');
  assert.equal(K.writeQuery(osa, '', st('a3f2', 2, 'bingo', 'line')), 's=a3f2&c=2');
  assert.equal(K.writeQuery(osa, '', st('a3f2', 2, 'hunt', 'line')), 's=a3f2&c=2&m=hunt');
  assert.equal(K.writeQuery(osa, '', st('a3f2', 1, 'race', 'line')), 's=a3f2&c=1&m=race');
  assert.equal(K.writeQuery(osa, '', st('a3f2', 1, 'bingo', 'corners')), 's=a3f2&c=1&p=corners');
  assert.equal(K.writeQuery(osa, '', st('a3f2', 2, 'race', 'x')), 's=a3f2&c=2&m=race&p=x');
});

test('Moplants writes the racer (c) only in a race', () => {
  assert.equal(K.writeQuery(mo, '', st('a3f2', 1, 'bingo', 'line')), 's=a3f2');
  assert.equal(K.writeQuery(mo, '', st('a3f2', 2, 'bingo', 'blackout')), 's=a3f2&p=blackout');
  assert.equal(K.writeQuery(mo, '', st('a3f2', 2, 'hunt', 'line')), 's=a3f2&m=hunt');
  assert.equal(K.writeQuery(mo, '', st('a3f2', 2, 'race', 'line')), 's=a3f2&c=2&m=race');
  assert.equal(K.writeQuery(mo, '', st('a3f2', 1, 'race', 'x')), 's=a3f2&c=1&m=race&p=x');
});

test('Writing keeps unrelated params and drops the ones a mode does not need', () => {
  assert.equal(K.writeQuery(mo, '?s=old&c=2&m=race&p=x&utm=1', st('new', 1, 'bingo', 'line')), 's=new&utm=1');
  assert.equal(K.writeQuery(osa, '?s=old&m=race&p=x&utm=1', st('new', 1, 'bingo', 'line')), 's=new&utm=1&c=1');
});

test('Both read ?s= ?c= ?m= ?p=; anything but c=2 is card 1', () => {
  for (const cfg of [osa, mo]) {
    assert.deepEqual(plain(K.readQuery(cfg, '?s=a3f2&c=2&m=race&p=x')),
      { seed: 'a3f2', card: 2, mode: 'race', pattern: 'x' });
    assert.deepEqual(plain(K.readQuery(cfg, '?s=a3f2')),
      { seed: 'a3f2', card: 1, mode: null, pattern: null });
    assert.equal(K.readQuery(cfg, '?s=a&c=1').card, 1);
    assert.equal(K.readQuery(cfg, '?s=a&c=3').card, 1);
    assert.equal(K.readQuery(cfg, '?s=a&c=').card, 1);
    assert.equal(K.readQuery(cfg, '?s=a&m=nope').mode, null);
    assert.equal(K.readQuery(cfg, '?s=a&p=toString').pattern, null);
    assert.equal(K.readQuery(cfg, '?s=%20a3f2%20').seed, 'a3f2');
    assert.equal(K.readQuery(cfg, '').seed, '');
  }
});
