/* =============================================================
   Osa Peninsula Wildlife Bingo
   Plain JS, no framework. State is a Set of marked cell indices.

   One seed generates a complementary PAIR of cards:
   the 48 species are partitioned into two non-overlapping 24s
   and each is dealt into fixed grid positions. Two people on the
   same seed hold complementary cards (card 1 and card 2).

   Three games share the data and the seed:
   - bingo: the 5 x 5 card, with a choice of win pattern
   - hunt:  every species as one checklist for the whole trip
   - race:  each racer gets 10 targets from the seed; first to
            find all of theirs wins
   ============================================================= */

(() => {
  'use strict';

  const CACHE_NS = 'osa-bingo:v1';        // localStorage namespace
  const GRID = 25;                        // 5 x 5
  const CENTER = 12;                      // FREE cell index
  const POSITIONS = Array.from({ length: GRID }, (_, i) => i).filter(i => i !== CENTER);
  const RACE_SIZE = 10;                   // targets per racer
  const MODES = ['bingo', 'hunt', 'race'];

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

  // ---- The deal ----------------------------------------------
  // Stratified round-robin: within each category, deal to whichever
  // card currently holds fewer species (ties broken by the seeded
  // stream). Because we always feed the smaller card, the totals stay
  // within one of each other and land at exactly 24 / 24, while every
  // category is split roughly in half across the two cards.
  function deal(species, rng) {
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

  // Winning lines: 5 rows, 5 cols, 2 diagonals (cell indices 0..24).
  const LINES = (() => {
    const lines = [];
    for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
    for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
    lines.push([0, 6, 12, 18, 24]);
    lines.push([4, 8, 12, 16, 20]);
    return lines;
  })();

  // Win patterns. 'line' wins on any of the 12 lines; the others are one
  // shape that has to be filled completely. FREE always counts. Patterns
  // with `targets` outline their cells so you can see what to go after.
  const PATTERNS = {
    line:     { label: 'Any line',     hint: 'Fill any row, column or diagonal.', lines: LINES },
    corners:  { label: 'Four corners', hint: 'Spot the four species in the corners.', lines: [[0, 4, 20, 24]], targets: true,
                win: 'All four corners. Bingo.' },
    x:        { label: 'Big X',        hint: 'Fill both diagonals.', lines: [[0, 6, 12, 18, 24, 4, 8, 16, 20]], targets: true,
                win: 'The X is complete. Bingo.' },
    blackout: { label: 'Blackout',     hint: 'Spot all 24 species on your card.', lines: [Array.from({ length: GRID }, (_, i) => i)],
                win: 'Full card. Every cell on the board.' },
  };

  // The race reuses the bingo deal on its own stream, so racer 1 and racer 2
  // draw from opposite halves and never chase the same species.
  function dealRace(species, seed) {
    return deal(species, makeRng(`${seed}:race`)).map(card => card.slice(0, RACE_SIZE));
  }

  // ---- Persistence (per seed + card) -------------------------
  const marksKey = (seed, card) => `${CACHE_NS}:${seed}:c${card}`;
  const LAST_KEY = `${CACHE_NS}:last`;
  // Remember the current card so relaunching the installed app (start_url
  // has no seed) reopens your in-progress card instead of dealing a new one.
  function saveLast() {
    const { seed, card, mode, pattern } = state;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ seed, card, mode, pattern })); } catch { /* ignore */ }
  }
  function loadLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
  }
  function loadMarks(seed, card) {
    try {
      const raw = localStorage.getItem(marksKey(seed, card));
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function saveMarks(seed, card, set) {
    try { localStorage.setItem(marksKey(seed, card), JSON.stringify([...set])); }
    catch { /* private mode / blocked storage: card still works this session */ }
  }
  function hasSavedMarks(seed, card) {
    try { return localStorage.getItem(marksKey(seed, card)) !== null; }
    catch { return false; }
  }
  // Load saved marks, splitting out the FREE center's checked flag (persisted
  // as CENTER inside the same set). A brand-new card starts with FREE checked.
  function applySavedMarks(seed, card) {
    const saved = loadMarks(seed, card);
    state.free = hasSavedMarks(seed, card) ? saved.has(CENTER) : true;
    saved.delete(CENTER);
    state.marks = saved;
  }
  // Persist the marks and the FREE flag together.
  function persist() {
    const set = new Set(state.marks);
    if (state.free) set.add(CENTER);
    saveMarks(state.seed, state.card, set);
  }

  // Race marks live beside the bingo marks under their own key, with the
  // finish time (epoch ms) kept separately so racers can compare.
  const raceKey = (seed, card) => `${CACHE_NS}:${seed}:r${card}`;
  function loadRace(seed, card) {
    try {
      const arr = JSON.parse(localStorage.getItem(raceKey(seed, card)) || '[]');
      state.raceMarks = new Set(Array.isArray(arr) ? arr : []);
    } catch { state.raceMarks = new Set(); }
    try { state.raceEnd = Number(localStorage.getItem(`${raceKey(seed, card)}:end`)) || null; }
    catch { state.raceEnd = null; }
  }
  function persistRace() {
    try {
      localStorage.setItem(raceKey(state.seed, state.card), JSON.stringify([...state.raceMarks]));
      const k = `${raceKey(state.seed, state.card)}:end`;
      if (state.raceEnd) localStorage.setItem(k, String(state.raceEnd));
      else localStorage.removeItem(k);
    } catch { /* ignore */ }
  }

  // The hunt list is one checklist per phone, not per seed: it runs the trip.
  const HUNT_KEY = `${CACHE_NS}:hunt`;
  function loadFound() {
    try {
      const arr = JSON.parse(localStorage.getItem(HUNT_KEY) || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function saveFound() {
    try { localStorage.setItem(HUNT_KEY, JSON.stringify([...state.found])); } catch { /* ignore */ }
  }

  // ---- URL / seed --------------------------------------------
  function randomSeed() {
    // short, shareable token; xmur3 hashes it anyway so any string works
    const n = (crypto?.getRandomValues?.(new Uint32Array(1))[0]) ?? (Math.random() * 2 ** 32);
    return (n >>> 0).toString(36).slice(0, 5).padStart(4, '0');
  }
  // Mode and pattern are null when the URL does not name them, so the caller
  // can fall back to the last-used ones. Bingo / 'line' are left out of the
  // URL, which keeps links from before the other games working unchanged.
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const s = (p.get('s') || '').trim();
    const c = p.get('c') === '2' ? 2 : 1;
    const m = MODES.includes(p.get('m')) ? p.get('m') : null;
    const pat = Object.hasOwn(PATTERNS, p.get('p') || '') ? p.get('p') : null;
    return { seed: s, card: c, mode: m, pattern: pat };
  }
  function writeUrl(push) {
    const p = new URLSearchParams(location.search);
    p.set('s', state.seed);
    p.set('c', String(state.card));
    if (state.mode === 'bingo') p.delete('m'); else p.set('m', state.mode);
    if (state.pattern === 'line') p.delete('p'); else p.set('p', state.pattern);
    const url = `${location.pathname}?${p.toString()}`;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ---- Small helpers -----------------------------------------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to the legacy path (older / non-secure contexts) */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
  function pictureHtml(stem, alt, cls) {
    return `<picture>` +
      `<source srcset="${esc(stem)}.webp" type="image/webp">` +
      `<img class="${cls}" src="${esc(stem)}.jpg" alt="${esc(alt)}" decoding="async" draggable="false">` +
      `</picture>`;
  }
  const checkSvg = cls => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CHECK = checkSvg('cell__check');
  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ---- App state ---------------------------------------------
  const state = {
    data: null,       // parsed species.json
    seed: '',
    card: 1,          // 1 or 2
    layout: [],       // 24 species for the current card, in position order
    marks: new Set(), // marked cell indices (0..24), excluding CENTER
    free: true,       // FREE center checked (tap toggles; it always counts for lines)
    lines: 0,         // completed line count last render
    mode: 'bingo',    // 'bingo' | 'hunt' | 'race'
    pattern: 'line',  // key of PATTERNS
    found: new Set(), // hunt: species ids found, across every seed
    huntFilter: 'all',// hunt: category shown, or 'all'
    race: [],         // race: this racer's RACE_SIZE targets
    raceMarks: new Set(), // race: found target indices (0..RACE_SIZE-1)
    raceEnd: null,    // race: when the last target was found (epoch ms)
  };

  // Map a grid cell index -> species (or null for the free center).
  function speciesAt(index) {
    if (index === CENTER) return null;
    return state.layout[POSITIONS.indexOf(index)] || null;
  }

  function completedLines() {
    const done = [];
    for (const line of PATTERNS[state.pattern].lines) {
      if (line.every(i => i === CENTER || state.marks.has(i))) done.push(line);
    }
    return done;
  }

  // ---- Rendering ---------------------------------------------
  // buildGrid() rewrites all 25 cells (card load / flip / reset).
  // Marking uses paintCell()/paintLines() to touch only what changed,
  // so a tap never rebuilds the grid or reloads its images.
  function render() {
    renderChrome();
    if (state.mode === 'bingo') { buildGrid(); renderBingo(false); }
    else if (state.mode === 'hunt') { buildHunt(); renderHuntDone(); }
    else { buildRace(); renderRaceDone(false); }
    renderProgress();
  }

  // Mode switch, pattern chips, section visibility and the mode-specific
  // labels on the shared controls.
  function renderChrome() {
    const { mode } = state;
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }
    for (const b of document.querySelectorAll('[data-pattern]')) {
      b.setAttribute('aria-pressed', String(b.dataset.pattern === state.pattern));
    }
    $('#patterns').hidden = mode !== 'bingo';
    $('#grid').hidden = mode !== 'bingo';
    $('#hunt').hidden = mode !== 'hunt';
    $('#race').hidden = mode !== 'race';
    $('#card-toggle').hidden = mode === 'hunt';
    $('#copy-link').hidden = mode === 'hunt';
    $('#new-card').hidden = mode === 'hunt';
    $('#new-card').textContent = mode === 'race' ? 'New race' : 'New card';
    $('#copy-link .menu__share-head').textContent = mode === 'race' ? 'Copy link to this race' : 'Copy link to this card';
    $('#mode-hint').textContent =
      mode === 'hunt' ? 'Every species on the list, for the whole trip. Tap each one the first time you see it.'
      : mode === 'race' ? `Two racers on the same seed get ${RACE_SIZE} different targets each. First to find all of theirs wins.`
      : PATTERNS[state.pattern].hint;
  }

  function hideBanner() {
    const banner = $('#bingo-banner');
    banner.hidden = true; banner.textContent = '';
  }
  function showBanner(stamp, msg) {
    const banner = $('#bingo-banner');
    banner.hidden = false;
    banner.innerHTML = `<span class="bingo-banner__stamp">${esc(stamp)}</span> <span>${esc(msg)}</span>`;
  }
  function buzz() {
    if ('vibrate' in navigator) { try { navigator.vibrate(30); } catch { /* not supported */ } }
  }

  function patternTargets() {
    return PATTERNS[state.pattern].targets ? new Set(PATTERNS[state.pattern].lines[0]) : new Set();
  }

  function buildGrid() {
    const grid = $('#grid');
    const lineCells = new Set(completedLines().flat());
    const targets = patternTargets();
    let html = '';
    for (let i = 0; i < GRID; i++) {
      if (i === CENTER) {
        const on = state.free;
        html += `<div class="cell cell--free${on ? ' is-marked' : ''}">` +
          `<button class="cell__mark cell__free-btn" type="button" aria-pressed="${on}" ` +
          `aria-label="Free space${on ? ', marked' : ', tap to mark'}" data-free="1">` +
          `<span class="cell--free__stamp">free.</span>` +
          CHECK +
          `</button></div>`;
        continue;
      }
      const s = speciesAt(i);
      if (!s) { html += `<div class="cell cell--empty" aria-hidden="true"></div>`; continue; }
      const marked = state.marks.has(i);
      const inLine = lineCells.has(i);
      html += `<div class="cell${marked ? ' is-marked' : ''}${inLine ? ' is-line' : ''}${targets.has(i) ? ' is-target' : ''}" data-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(s.name)}${marked ? ', spotted' : ''}" data-mark="${i}">` +
        pictureHtml(s.photo, s.name, 'cell__photo') +
        `<span class="cell__name">${esc(s.name)}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(s.name)}" data-info="${i}">i</button>` +
        `</div>`;
    }
    grid.innerHTML = html;
  }

  function paintCell(i) {
    const cell = $(`#grid .cell[data-index="${i}"]`);
    if (!cell) return;
    const marked = state.marks.has(i);
    cell.classList.toggle('is-marked', marked);
    const btn = cell.querySelector('.cell__mark');
    if (btn) {
      btn.setAttribute('aria-pressed', String(marked));
      const name = speciesAt(i)?.name || '';
      btn.setAttribute('aria-label', `${name}${marked ? ', spotted' : ''}`);
    }
  }

  function paintLines() {
    const lineCells = new Set(completedLines().flat());
    for (const cell of document.querySelectorAll('#grid .cell[data-index]')) {
      cell.classList.toggle('is-line', lineCells.has(Number(cell.dataset.index)));
    }
  }

  // The FREE center's check is cosmetic — it always counts toward a line, but
  // the player can tap it on or off like any other cell.
  function paintFree() {
    const cell = $('#grid .cell--free');
    if (!cell) return;
    cell.classList.toggle('is-marked', state.free);
    const btn = cell.querySelector('[data-free]');
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.free));
      btn.setAttribute('aria-label', `Free space${state.free ? ', marked' : ', tap to mark'}`);
    }
  }
  function toggleFree() {
    state.free = !state.free;
    persist();
    paintFree();
  }

  function renderProgress() {
    let text;
    if (state.mode === 'hunt') {
      text = `${state.found.size} of ${state.data.species.length} found`;
    } else if (state.mode === 'race') {
      text = `${state.raceMarks.size} of ${RACE_SIZE} found`;
    } else {
      text = `${state.marks.size} of ${POSITIONS.length} spotted`;
      const targets = [...patternTargets()].filter(i => i !== CENTER);
      if (targets.length) {
        text += ` · ${targets.filter(i => state.marks.has(i)).length} of ${targets.length} on the pattern`;
      }
    }
    $('#progress').textContent = text;
    $('#card-toggle').textContent = `${state.mode === 'race' ? 'Racer' : 'Card'} ${state.card} of 2`;
    $('#seed').textContent = state.seed;
  }

  function renderBingo(justChanged) {
    const done = completedLines();
    const n = done.length;
    if (n === 0) { hideBanner(); state.lines = 0; return; }
    let msg = PATTERNS[state.pattern].win;
    if (!msg) {
      if (state.marks.size === POSITIONS.length) msg = 'Full card. Every cell on the board.';
      else if (n === 1) msg = 'That is a line. Bingo.';
      else msg = `${n} full lines now.`;
    }
    showBanner('bingo.', msg);
    if (justChanged && n > state.lines) buzz();
    state.lines = n;
  }

  // ---- Hunt (one checklist of every species) -----------------
  const CATEGORY_LABELS = {
    bird: 'Birds', mammal: 'Mammals', reptile: 'Reptiles', amphibian: 'Amphibians',
    invertebrate: 'Invertebrates', marine: 'Marine life', plant: 'Plants',
  };
  const categoryLabel = cat => CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  // Categories in species.json order, so the list reads the way the data does.
  function huntCategories() {
    return [...new Set(state.data.species.map(s => s.category))];
  }
  const speciesById = id => state.data.species.find(s => s.id === id) || null;

  function renderHuntFilters() {
    const all = state.data.species;
    const chip = (key, label, members) => {
      const got = members.filter(s => state.found.has(s.id)).length;
      return `<button class="chip" type="button" data-hunt-filter="${esc(key)}" ` +
        `aria-pressed="${state.huntFilter === key}">${esc(label)}` +
        `<span class="chip__count">${got}/${members.length}</span></button>`;
    };
    $('#hunt-filters').innerHTML = chip('all', 'All', all) +
      huntCategories().map(cat => chip(cat, categoryLabel(cat), all.filter(s => s.category === cat))).join('');
  }

  function huntRowHtml(s) {
    const found = state.found.has(s.id);
    return `<li class="hunt__item${found ? ' is-found' : ''}" data-id="${esc(s.id)}">` +
      `<button class="hunt__mark" type="button" aria-pressed="${found}" ` +
      `aria-label="${esc(s.name)}${found ? ', found' : ''}" data-hunt="${esc(s.id)}">` +
      pictureHtml(s.photo, '', 'hunt__thumb') +
      `<span class="hunt__text"><span class="hunt__name">${esc(s.name)}</span>` +
      (s.binomial ? `<span class="hunt__bino">${esc(s.binomial)}</span>` : '') + `</span>` +
      `<span class="hunt__box">${checkSvg('hunt__check')}</span>` +
      `</button>` +
      `<button class="hunt__info" type="button" aria-label="About ${esc(s.name)}" data-hunt-info="${esc(s.id)}">i</button>` +
      `</li>`;
  }

  function buildHunt() {
    renderHuntFilters();
    const cats = state.huntFilter === 'all' ? huntCategories() : [state.huntFilter];
    $('#hunt-list').innerHTML = cats.map(cat =>
      `<h2 class="hunt__heading">${esc(categoryLabel(cat))}</h2>` +
      `<ul class="hunt__list">` +
      state.data.species.filter(s => s.category === cat).map(huntRowHtml).join('') +
      `</ul>`
    ).join('');
  }

  function toggleFound(id) {
    const wasDone = state.found.size === state.data.species.length;
    if (state.found.has(id)) state.found.delete(id);
    else state.found.add(id);
    saveFound();
    // Touch only the row and the chip counts, never the photos.
    const row = document.querySelector(`#hunt-list .hunt__item[data-id="${CSS.escape(id)}"]`);
    if (row) {
      const on = state.found.has(id);
      row.classList.toggle('is-found', on);
      const btn = row.querySelector('.hunt__mark');
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${speciesById(id)?.name || ''}${on ? ', found' : ''}`);
    }
    renderHuntFilters();
    renderProgress();
    renderHuntDone();
    if (!wasDone && state.found.size === state.data.species.length) buzz();
  }

  function renderHuntDone() {
    if (state.found.size === state.data.species.length) {
      showBanner('found.', `All ${state.found.size} species on the list. That is the whole peninsula.`);
    } else hideBanner();
  }

  // ---- Race (RACE_SIZE targets per racer) --------------------
  function buildRace() {
    let html = '';
    state.race.forEach((s, i) => {
      const marked = state.raceMarks.has(i);
      html += `<div class="cell${marked ? ' is-marked' : ''}" data-race-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(s.name)}${marked ? ', found' : ''}" data-race-mark="${i}">` +
        pictureHtml(s.photo, s.name, 'cell__photo') +
        `<span class="cell__name">${esc(s.name)}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(s.name)}" data-race-info="${i}">i</button>` +
        `</div>`;
    });
    $('#race').innerHTML = html;
  }

  function toggleRaceMark(i) {
    if (state.raceMarks.has(i)) state.raceMarks.delete(i);
    else state.raceMarks.add(i);
    const done = state.raceMarks.size === RACE_SIZE;
    const justFinished = done && !state.raceEnd;
    // The finish time is set on the last find and dropped if one is undone.
    if (justFinished) state.raceEnd = Date.now();
    if (!done) state.raceEnd = null;
    persistRace();
    const cell = $(`#race .cell[data-race-index="${i}"]`);
    if (cell) {
      const on = state.raceMarks.has(i);
      cell.classList.toggle('is-marked', on);
      const btn = cell.querySelector('.cell__mark');
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${state.race[i].name}${on ? ', found' : ''}`);
    }
    renderProgress();
    renderRaceDone(justFinished);
  }

  function renderRaceDone(justFinished) {
    if (state.raceMarks.size === RACE_SIZE && state.raceEnd) {
      showBanner('done.', `All ${RACE_SIZE} found at ${fmtClock(state.raceEnd)}. Compare times: the earlier finish wins.`);
      if (justFinished) buzz();
    } else hideBanner();
  }

  // ---- Detail sheet ------------------------------------------
  // The sheet works for any game: it gets the species plus how to read and
  // flip that species' mark in the current game.
  let detail = null;   // { isMarked(), toggle() }
  function openDetail(s, isMarked, toggle) {
    if (!s) return;
    detail = { isMarked, toggle };
    $('#detail-picture').innerHTML =
      `<source srcset="${esc(s.photo)}.webp" type="image/webp">` +
      `<img src="${esc(s.photo)}.jpg" alt="${esc(s.name)}" decoding="async">`;
    $('#detail-category').textContent = s.category;
    $('#detail-name').textContent = s.name;
    const bino = $('#detail-binomial');
    bino.textContent = s.binomial || '';
    bino.hidden = !s.binomial;
    $('#detail-note').textContent = s.id_note || '';
    $('#detail-fact').textContent = s.fun_fact || '';

    const safety = $('#detail-safety');
    if (s.safety) { safety.textContent = s.safety; safety.hidden = false; }
    else { safety.textContent = ''; safety.hidden = true; }

    $('#detail-credit').innerHTML = creditLine(s.credit);
    syncDetailMark();
    const dlg = $('#detail');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function syncDetailMark() {
    const btn = $('#detail-mark');
    const marked = detail.isMarked();
    btn.textContent = marked ? 'Spotted. Tap to undo.' : 'Mark as spotted';
    btn.classList.toggle('is-marked', marked);
    btn.setAttribute('aria-pressed', String(marked));
  }
  function creditLine(credit) {
    if (!credit || credit.status === 'unsourced' || (!credit.author && !credit.source)) {
      return `<span class="sheet__credit--pending">Photo credit pending. This image is a placeholder until a properly licensed photo is sourced.</span>`;
    }
    const bits = [];
    if (credit.author) bits.push(esc(credit.author));
    if (credit.license) bits.push(esc(credit.license));
    let line = `Photo: ${bits.join(' · ')}`;
    if (credit.source) line += ` · <a href="${esc(credit.source)}" target="_blank" rel="noopener">source</a>`;
    return line;
  }

  // ---- Marking -----------------------------------------------
  function toggleMark(index) {
    if (index === CENTER) return;
    if (state.marks.has(index)) state.marks.delete(index);
    else state.marks.add(index);
    persist();
    // Touch only the toggled cell, then recompute line rings / banner.
    paintCell(index);
    paintLines();
    renderProgress();
    renderBingo(true);
  }

  // ---- Safety + credits (static per data) --------------------
  function renderSafety() {
    const ul = $('#safety-list');
    ul.innerHTML = state.data.safety.map(item => {
      const tag = item.in_pool
        ? `<span class="safety__tag safety__tag--card">on the card</span>`
        : `<span class="safety__tag">not on the card</span>`;
      const bino = item.binomial ? ` <em>${esc(item.binomial)}</em>` : '';
      return `<li class="safety__item">` +
        `<p class="safety__name">${esc(item.name)}${bino} ${tag}</p>` +
        `<p class="safety__note">${esc(item.note)}</p>` +
        `</li>`;
    }).join('');
  }
  function renderCredits() {
    const ul = $('#credits-list');
    ul.innerHTML = state.data.species.map(s =>
      `<li><span class="credits__sp">${esc(s.name)}</span> ${creditLine(s.credit)}</li>`
    ).join('');
  }

  // ---- Wiring a card -----------------------------------------
  function applyCard(seed, card) {
    state.seed = seed;
    state.card = card;
    const rng = makeRng(seed);
    const pair = deal(state.data.species, rng);
    state.layout = pair[card - 1];
    applySavedMarks(seed, card);
    state.race = dealRace(state.data.species, seed)[card - 1];
    loadRace(seed, card);
  }
  function loadCard(seed, card, push) {
    applyCard(seed, card);
    saveLast();
    writeUrl(push);
    render();
  }
  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    saveLast();
    writeUrl(true);
    render();
  }
  function setPattern(pattern) {
    if (pattern === state.pattern) return;
    state.pattern = pattern;
    saveLast();
    writeUrl(false);
    render();
  }

  function newSeed() {
    loadCard(randomSeed(), 1, true);
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  function flipCard() {
    loadCard(state.seed, state.card === 1 ? 2 : 1, true);
  }
  function askReset() {
    const { mode } = state;
    const n = mode === 'hunt' ? state.found.size : mode === 'race' ? state.raceMarks.size : state.marks.size;
    if (n === 0) return;                           // nothing to clear, no prompt
    const what = `${n} ${mode === 'bingo' ? 'mark' : 'find'}${n === 1 ? '' : 's'}`;
    $('#confirm-title').textContent =
      mode === 'hunt' ? 'Reset your hunt list?' : mode === 'race' ? 'Reset this race?' : 'Reset this card?';
    $('#confirm-body').textContent =
      mode === 'hunt' ? `This clears ${what} on your hunt list. You cannot undo it.`
      : mode === 'race' ? `This clears ${what} for racer ${state.card}. You cannot undo it.`
      : `This clears ${what} on card ${state.card}. You cannot undo it.`;
    const dlg = $('#confirm-reset');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function resetMarks() {
    if (state.mode === 'hunt') {
      state.found = new Set();
      saveFound();
    } else if (state.mode === 'race') {
      state.raceMarks = new Set();
      state.raceEnd = null;
      persistRace();
    } else {
      state.marks = new Set();
      state.free = true;
      persist();
    }
    render();
  }

  // ---- Init --------------------------------------------------
  async function init() {
    try {
      const res = await fetch('species.json', { cache: 'no-cache' });
      state.data = await res.json();
    } catch (err) {
      $('#grid').innerHTML = `<p class="loaderr">Could not load the species list. If you are offline, open the app once on wifi first so it can cache.</p>`;
      return;
    }

    renderSafety();
    renderCredits();
    state.found = loadFound();

    // Event delegation on the grid.
    $('#grid').addEventListener('click', e => {
      const free = e.target.closest('[data-free]');
      if (free) { toggleFree(); return; }
      const mark = e.target.closest('[data-mark]');
      if (mark) { toggleMark(Number(mark.dataset.mark)); return; }
      const info = e.target.closest('[data-info]');
      if (info) {
        const i = Number(info.dataset.info);
        openDetail(speciesAt(i), () => state.marks.has(i), () => toggleMark(i));
      }
    });
    $('#hunt').addEventListener('click', e => {
      const filter = e.target.closest('[data-hunt-filter]');
      if (filter) { state.huntFilter = filter.dataset.huntFilter; buildHunt(); return; }
      const mark = e.target.closest('[data-hunt]');
      if (mark) { toggleFound(mark.dataset.hunt); return; }
      const info = e.target.closest('[data-hunt-info]');
      if (info) {
        const id = info.dataset.huntInfo;
        openDetail(speciesById(id), () => state.found.has(id), () => toggleFound(id));
      }
    });
    $('#race').addEventListener('click', e => {
      const mark = e.target.closest('[data-race-mark]');
      if (mark) { toggleRaceMark(Number(mark.dataset.raceMark)); return; }
      const info = e.target.closest('[data-race-info]');
      if (info) {
        const i = Number(info.dataset.raceInfo);
        openDetail(state.race[i], () => state.raceMarks.has(i), () => toggleRaceMark(i));
      }
    });
    $('#modes').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (b) setMode(b.dataset.mode);
    });
    $('#patterns').addEventListener('click', e => {
      const b = e.target.closest('[data-pattern]');
      if (b) setPattern(b.dataset.pattern);
    });

    $('#detail-mark').addEventListener('click', () => {
      detail.toggle();
      syncDetailMark();
    });
    // Tap the dimmed backdrop (outside the drawer) to dismiss it, the way a
    // bottom sheet should close. Escape and the × button close it too.
    $('#detail').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.close();
    });
    $('#card-toggle').addEventListener('click', flipCard);
    $('#new-card').addEventListener('click', newSeed);
    $('#reset').addEventListener('click', askReset);

    // Actions menu: close it after a choice, on an outside click, or on Escape.
    const actionsMenu = $('#actions-menu');
    if (actionsMenu) {
      $('#copy-link').addEventListener('click', async () => {
        const head = $('#copy-link').querySelector('.menu__share-head');
        const label = head.textContent;
        const ok = await copyText(location.href);           // the URL already carries ?s=<seed>&c=<card>[&m=&p=]
        head.textContent = ok ? 'Link copied' : 'Copy failed — select and copy';
        clearTimeout(head._resetT);
        head._resetT = setTimeout(() => { head.textContent = label; }, 1800);
      });
      actionsMenu.querySelector('.menu__panel').addEventListener('click', e => {
        const btn = e.target.closest('button');
        // Keep the menu open for copy-link so its "Link copied" feedback shows.
        if (btn && btn.id !== 'copy-link') actionsMenu.open = false;
      });
      document.addEventListener('click', e => {
        if (actionsMenu.open && !actionsMenu.contains(e.target)) actionsMenu.open = false;
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && actionsMenu.open) actionsMenu.open = false;
      });
    }
    $('#confirm-cancel').addEventListener('click', () => $('#confirm-reset').close());
    $('#confirm-yes').addEventListener('click', () => { $('#confirm-reset').close(); resetMarks(); });

    // Back / forward through seeds, card flips and mode switches.
    window.addEventListener('popstate', () => {
      const url = readUrl();
      if (!url.seed) return;
      state.mode = url.mode || 'bingo';
      state.pattern = url.pattern || 'line';
      applyCard(url.seed, url.card);
      saveLast();
      render();
    });

    // Seed resolution: an explicit URL seed wins; otherwise reopen the last
    // card you were on (so the installed app resumes offline); otherwise deal
    // a fresh seed. Mode and pattern resolve the same way. Either way it is
    // written into the URL so it is linkable.
    const url = readUrl();
    const last = loadLast() || {};
    state.mode = url.mode || (MODES.includes(last.mode) ? last.mode : 'bingo');
    state.pattern = url.pattern || (Object.hasOwn(PATTERNS, last.pattern || '') ? last.pattern : 'line');
    if (url.seed) loadCard(url.seed, url.card, false);
    else if (last.seed) loadCard(last.seed, last.card === 2 ? 2 : 1, false);
    else loadCard(randomSeed(), 1, false);
  }

  // ---- Service worker (offline is the whole point) -----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* still works online */ });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
