/* =============================================================
   Bingo core: the seeded deal, and the storage keys and URL rules.
   Plain classic script, no modules. It puts two objects on the
   global, BingoDeal and BingoKeys, and touches nothing else, so it
   also loads in node (test/deal.test.mjs, test/storage.test.mjs).

   The deal is what a shared link means: ?s=<seed> is only a seed, and
   every phone recomputes the card from it. Nothing in here may change
   its output. The pinned results are in test/fixtures/deal-golden.json.

   The keys and query rules are what is already saved on people's
   phones and in links they have sent. test/storage.test.mjs pins them.
   ============================================================= */

(() => {
  'use strict';

  // ---- Deterministic PRNG ------------------------------------
  // xmur3 hashes the seed string to a 32-bit integer; mulberry32
  // turns that into a stream of floats. Both are pure integer math,
  // so the same seed yields the same cards in every browser.
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  // Reference mulberry32, kept verbatim: the deal (and every shared link)
  // depends on its exact output. See test/deal.test.mjs.
  function mulberry32(a) {
    return () => {
      // oxlint-disable-next-line no-param-reassign
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    return mulberry32(xmur3(String(seed))());
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- Deal: stratified pair (Osa) ---------------------------
  // Stratified round-robin: within each category, deal to whichever
  // card currently holds fewer species (ties broken by the seeded
  // stream). Because we always feed the smaller card, the totals stay
  // within one of each other and land at exactly 24 / 24, while every
  // category is split roughly in half across the two cards.
  function dealStratifiedPair(species, rng) {
    const categories = [...new Set(species.map(s => s.category))].sort();
    const cards = [[], []];
    for (const cat of categories) {
      const members = shuffle(species.filter(s => s.category === cat), rng);
      for (const s of members) {
        let side;
        if (cards[0].length < cards[1].length) side = 0;
        else if (cards[1].length < cards[0].length) side = 1;
        else side = rng() < 0.5 ? 0 : 1;
        cards[side].push(s);
      }
    }
    // Fix grid positions by shuffling each card's 24 into order.
    return cards.map(card => shuffle([...card], rng));
  }

  // ---- Strategies, by the names a game.json uses -------------
  // deal[name](items, seed)        -> one layout per card (array of arrays)
  // race[name](items, seed, size)  -> one target list per racer
  const deal = {
    // Osa: one seed makes a complementary pair of cards.
    'stratified-pair': (species, seed) => dealStratifiedPair(species, makeRng(seed)),
    // Moplants: one card holding the whole list in a seeded order.
    'shuffle-all': (plants, seed) => [shuffle([...plants], makeRng(seed))],
  };
  const race = {
    // The race reuses the pair deal on its own stream, so racer 1 and racer 2
    // draw from opposite halves and never chase the same species.
    'stratified-pair': (species, seed, size) =>
      dealStratifiedPair(species, makeRng(`${seed}:race`)).map(card => card.slice(0, size)),
    // The race shuffles the list on its own stream and splits off two
    // non-overlapping sets, so racer 1 and racer 2 never chase the same plant.
    'shuffle-split': (plants, seed, size) => {
      const order = shuffle([...plants], makeRng(`${seed}:race`));
      return [order.slice(0, size), order.slice(size, 2 * size)];
    },
  };

  // ---- Storage keys and the URL ------------------------------
  // `cfg` is a game.json: cfg.storage = { ns, marks: 'cells' | 'ids', legacyLast },
  // cfg.urlCard = 'always' | 'race', cfg.modes[].id, cfg.patterns[].key.
  //   marks 'cells': marks live per seed AND card (Osa: ns:seed:c<card>)
  //   marks 'ids':   marks live per seed (Moplants: ns:seed)
  const keys = {
    marks: (cfg, seed, card) =>
      cfg.storage.marks === 'cells' ? `${cfg.storage.ns}:${seed}:c${card}` : `${cfg.storage.ns}:${seed}`,
    last: cfg => `${cfg.storage.ns}:last`,
    hunt: cfg => `${cfg.storage.ns}:hunt`,
    race: (cfg, seed, card) => `${cfg.storage.ns}:${seed}:r${card}`,
    raceEnd: (cfg, seed, card) => `${cfg.storage.ns}:${seed}:r${card}:end`,

    // The last-card record. Moplants once stored a bare seed string; with
    // storage.legacyLast that still loads as { seed }. Osa has no such form.
    parseLast(cfg, raw) {
      if (cfg.storage.legacyLast) {
        const text = raw || '';
        try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : { seed: text }; }
        catch { return { seed: text }; }
      }
      try { return JSON.parse(raw || 'null'); } catch { return null; }
    },

    // Mode and pattern are null when the URL does not name them, so the caller
    // can fall back to the last-used ones. Anything but c=2 is card 1.
    readQuery(cfg, search) {
      const p = new URLSearchParams(search);
      const m = p.get('m');
      const pat = p.get('p') || '';
      return {
        seed: (p.get('s') || '').trim(),
        card: p.get('c') === '2' ? 2 : 1,
        mode: cfg.modes.some(x => x.id === m) ? m : null,
        pattern: cfg.patterns.some(x => x.key === pat) ? pat : null,
      };
    },
    // Bingo and the first pattern are left out of the URL, which keeps older
    // links working. The card (c) is always written, or only in a race.
    writeQuery(cfg, search, state) {
      const p = new URLSearchParams(search);
      p.set('s', state.seed);
      if (cfg.urlCard === 'always' || state.mode === 'race') p.set('c', String(state.card));
      else p.delete('c');
      if (state.mode === cfg.modes[0].id) p.delete('m'); else p.set('m', state.mode);
      if (state.pattern === cfg.patterns[0].key) p.delete('p'); else p.set('p', state.pattern);
      return p.toString();
    },

    // What someone typed into "Open a shared card" (an installed app has no
    // address bar to paste into). It may be a whole message with a link in
    // it, a link, just its "?s=..." part, or a bare seed. `here` is the
    // current page's path, for a link with no path of its own.
    // -> { path, search } for a link: path and query only, so it always opens
    //    on this site, never wherever the pasted host points
    // -> { seed } for a bare seed
    // -> null when there is nothing usable
    parseShared(text, here = '/') {
      const t = String(text || '').trim();
      if (!t) return null;
      const inMessage = t.match(/https?:\/\/[^\s<>"']+/i);
      const link = inMessage ? inMessage[0]
        : /^[?/]/.test(t) || /[?&]s=/.test(t) || /^[\w-]+(\.[\w-]+)+\//.test(t) ? t : null;
      if (link) {
        let u;
        try {
          const abs = /^https?:\/\//i.test(link) || /^[?/]/.test(link) ? link : `https://${link}`;
          u = new URL(abs, `https://site.invalid${here}`);
        } catch { return null; }
        if (!(u.searchParams.get('s') || '').trim()) return null;
        return { path: u.pathname, search: u.search };
      }
      if (t.length > 64 || /\s{2,}|[?&#=/]/.test(t)) return null;
      return { seed: t };
    },
  };

  globalThis.BingoDeal = { xmur3, mulberry32, makeRng, shuffle, dealStratifiedPair, deal, race };
  globalThis.BingoKeys = keys;
})();
