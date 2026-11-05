/* =============================================================
   Plant Bingo (/moplants)
   Plain JS, no framework, no service worker. Built to behave like
   the Osa app (../app.js): same seeded deal, seed in the URL, copy
   link, per-seed marks, Actions menu and detail drawer.

   Differences from Osa: every card holds all 25 plants (no FREE
   center, no complementary pair), so a seed deals one card, the
   whole pool in a seeded order.

   Three games share the plants and the seed:
   - bingo: the 5 x 5 card, with a choice of win pattern
   - hunt:  every plant as one checklist that carries across cards
   - race:  each racer gets 10 targets from the seed; first to
            find all of theirs wins
   ============================================================= */

(() => {
  'use strict';

  const CACHE_NS = 'moplants-bingo:v2';   // localStorage namespace, unique to this game
  const GRID = 25;                        // 5 x 5, no free space
  const RACE_SIZE = 10;                   // targets per racer
  const MODES = ['bingo', 'hunt', 'race'];

  // ---- Deterministic PRNG ------------------------------------
  // Same as the Osa app: xmur3 hashes the seed string to a 32-bit
  // integer; mulberry32 turns that into a stream of floats. Pure
  // integer math, so a seed yields the same card in every browser.
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
  // The deal: all 25 plants, in a seeded order.
  function deal(plants, seed) {
    return shuffle([...plants], makeRng(seed));
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
  // shape that has to be filled completely. Patterns with `targets`
  // outline their cells so you can see what to go after.
  const PATTERNS = {
    line:     { hint: 'Fill any row, column or diagonal.', lines: LINES },
    corners:  { hint: 'Spot the four plants in the corners.', lines: [[0, 4, 20, 24]], targets: true,
                win: 'All four corners. Bingo.' },
    x:        { hint: 'Fill both diagonals.', lines: [[0, 6, 12, 18, 24, 4, 8, 16, 20]], targets: true,
                win: 'The X is complete. Bingo.' },
    blackout: { hint: 'Spot all 25 plants on the card.', lines: [Array.from({ length: GRID }, (_, i) => i)],
                win: 'Full card. Every plant on the board.' },
  };

  // The race shuffles the plants on its own stream and splits off two
  // non-overlapping sets, so racer 1 and racer 2 never chase the same plant.
  function dealRace(plants, seed) {
    const order = shuffle([...plants], makeRng(`${seed}:race`));
    return [order.slice(0, RACE_SIZE), order.slice(RACE_SIZE, 2 * RACE_SIZE)];
  }

  // ---- Persistence (per seed) --------------------------------
  // Marks are stored as plant ids, not cell indices, so they survive
  // any future change to the plant list.
  const marksKey = seed => `${CACHE_NS}:${seed}`;
  const LAST_KEY = `${CACHE_NS}:last`;
  // Remember the current seed so relaunching from the home screen (start_url
  // has no seed) reopens the in-progress card instead of dealing a new one.
  // Older versions stored the bare seed string; that still loads as { seed }.
  function saveLast() {
    const { seed, card, mode, pattern } = state;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ seed, card, mode, pattern })); } catch { /* ignore */ }
  }
  function loadLast() {
    let raw = '';
    try { raw = localStorage.getItem(LAST_KEY) || ''; } catch { return {}; }
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : { seed: raw }; }
    catch { return { seed: raw }; }
  }
  function loadMarks(seed) { return loadIds(marksKey(seed)); }
  function loadIds(key) {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function persist() {
    try { localStorage.setItem(marksKey(state.seed), JSON.stringify([...state.marks])); }
    catch { /* private mode / blocked storage: card still works this session */ }
  }

  // Race marks (plant ids) live beside the bingo marks under their own key,
  // with the finish time (epoch ms) kept separately so racers can compare.
  const raceKey = (seed, card) => `${CACHE_NS}:${seed}:r${card}`;
  function loadRace(seed, card) {
    state.raceMarks = loadIds(raceKey(seed, card));
    try { state.raceEnd = Number(localStorage.getItem(`${raceKey(seed, card)}:end`)) || null; }
    catch { state.raceEnd = null; }
  }
  function persistRace() {
    try {
      const k = raceKey(state.seed, state.card);
      localStorage.setItem(k, JSON.stringify([...state.raceMarks]));
      if (state.raceEnd) localStorage.setItem(`${k}:end`, String(state.raceEnd));
      else localStorage.removeItem(`${k}:end`);
    } catch { /* ignore */ }
  }

  // The hunt list is one checklist per phone, not per seed: every card
  // holds the same 25 plants, so it carries across cards.
  const HUNT_KEY = `${CACHE_NS}:hunt`;
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
  // URL, and the racer (c) is only written in a race, so older links still
  // open the plain card.
  function readUrl() {
    const p = new URLSearchParams(location.search);
    return {
      seed: (p.get('s') || '').trim(),
      card: p.get('c') === '2' ? 2 : 1,
      mode: MODES.includes(p.get('m')) ? p.get('m') : null,
      pattern: Object.hasOwn(PATTERNS, p.get('p') || '') ? p.get('p') : null,
    };
  }
  function writeUrl(push) {
    const p = new URLSearchParams(location.search);
    p.set('s', state.seed);
    if (state.mode === 'race') p.set('c', String(state.card)); else p.delete('c');
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
  const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  const checkSvg = cls => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CHECK = checkSvg('cell__check');
  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ---- App state ---------------------------------------------
  const state = {
    data: null,       // parsed species.json
    seed: '',
    layout: [],       // all 25 plants, in position order
    marks: new Set(), // spotted plant ids
    lines: 0,         // completed line count last render
    mode: 'bingo',    // 'bingo' | 'hunt' | 'race'
    pattern: 'line',  // key of PATTERNS
    card: 1,          // race: racer 1 or 2
    found: new Set(), // hunt: plant ids found, across every card
    race: [],         // race: this racer's RACE_SIZE targets
    raceMarks: new Set(), // race: found plant ids
    raceEnd: null,    // race: when the last target was found (epoch ms)
  };

  const plantAt = index => state.layout[index] || null;
  const isMarked = index => state.marks.has(plantAt(index)?.id);

  function completedLines() {
    return PATTERNS[state.pattern].lines.filter(line => line.every(isMarked));
  }

  // ---- Rendering ---------------------------------------------
  // buildGrid() rewrites all 25 cells (card load / reset). Marking uses
  // paintCell()/paintLines() to touch only what changed, so a tap never
  // rebuilds the grid or reloads its images.
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
    $('#card-toggle').hidden = mode !== 'race';
    $('#copy-link').hidden = mode === 'hunt';
    $('#new-card').hidden = mode === 'hunt';
    $('#new-card').textContent = mode === 'race' ? 'New race' : 'New card';
    $('#copy-link .menu__share-head').textContent = mode === 'race' ? 'Copy link to this race' : 'Copy link to this card';
    $('#mode-hint').textContent =
      mode === 'hunt' ? 'All 25 plants as one checklist that carries across cards. Tap each one the first time you see it.'
      : mode === 'race' ? `Two racers on the same seed get ${RACE_SIZE} different plants each. First to find all of theirs wins.`
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
    const lineCells = new Set(completedLines().flat());
    const targets = patternTargets();
    let html = '';
    for (let i = 0; i < GRID; i++) {
      const p = plantAt(i);
      const marked = isMarked(i);
      const label = p.short || p.name;
      html += `<div class="cell${marked ? ' is-marked' : ''}${lineCells.has(i) ? ' is-line' : ''}${targets.has(i) ? ' is-target' : ''}" data-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(p.name)}${marked ? ', spotted' : ''}" data-mark="${i}">` +
        pictureHtml(`img/thumb/${p.id}`, p.name, 'cell__photo') +
        `<span class="cell__name">${esc(label)}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(p.name)}" data-info="${i}">i</button>` +
        `</div>`;
    }
    $('#grid').innerHTML = html;
  }

  function paintCell(i) {
    const cell = $(`#grid .cell[data-index="${i}"]`);
    if (!cell) return;
    const marked = isMarked(i);
    cell.classList.toggle('is-marked', marked);
    const btn = cell.querySelector('.cell__mark');
    btn.setAttribute('aria-pressed', String(marked));
    btn.setAttribute('aria-label', `${plantAt(i).name}${marked ? ', spotted' : ''}`);
  }

  function paintLines() {
    const lineCells = new Set(completedLines().flat());
    for (const cell of document.querySelectorAll('#grid .cell[data-index]')) {
      cell.classList.toggle('is-line', lineCells.has(Number(cell.dataset.index)));
    }
  }

  function renderProgress() {
    let text;
    if (state.mode === 'hunt') {
      text = `${state.found.size} of ${state.data.species.length} found`;
    } else if (state.mode === 'race') {
      text = `${state.raceMarks.size} of ${RACE_SIZE} found`;
    } else {
      text = `${state.marks.size} of ${GRID} spotted`;
      const targets = [...patternTargets()];
      if (targets.length) text += ` · ${targets.filter(isMarked).length} of ${targets.length} on the pattern`;
    }
    $('#progress').textContent = text;
    $('#card-toggle').textContent = `Racer ${state.card} of 2`;
    $('#seed').textContent = state.seed;
  }

  function renderBingo(justChanged) {
    const n = completedLines().length;
    if (n === 0) { hideBanner(); state.lines = 0; return; }
    let msg = PATTERNS[state.pattern].win;
    if (!msg) {
      if (state.marks.size === GRID) msg = 'Full card. Every plant on the board.';
      else if (n === 1) msg = 'That is a line. Bingo.';
      else msg = `${n} full lines now.`;
    }
    showBanner('bingo.', msg);
    if (justChanged && n > state.lines) buzz();
    state.lines = n;
  }

  // ---- Hunt (one checklist of every plant) -------------------
  const plantById = id => state.data.species.find(p => p.id === id) || null;

  function buildHunt() {
    const plants = [...state.data.species].sort((a, b) => a.name.localeCompare(b.name));
    $('#hunt-list').innerHTML = plants.map(p => {
      const found = state.found.has(p.id);
      const bot = p.various ? `<span class="hunt__bino hunt__bino--plain">${esc(p.botanical)}</span>`
        : `<span class="hunt__bino">${esc(p.botanical)}</span>`;
      return `<li class="hunt__item${found ? ' is-found' : ''}" data-id="${esc(p.id)}">` +
        `<button class="hunt__mark" type="button" aria-pressed="${found}" ` +
        `aria-label="${esc(p.name)}${found ? ', found' : ''}" data-hunt="${esc(p.id)}">` +
        pictureHtml(`img/thumb/${p.id}`, '', 'hunt__thumb') +
        `<span class="hunt__text"><span class="hunt__name">${esc(p.name)}</span>${bot}</span>` +
        `<span class="hunt__box">${checkSvg('hunt__check')}</span>` +
        `</button>` +
        `<button class="hunt__info" type="button" aria-label="About ${esc(p.name)}" data-hunt-info="${esc(p.id)}">i</button>` +
        `</li>`;
    }).join('');
  }

  function toggleFound(id) {
    const total = state.data.species.length;
    const wasDone = state.found.size === total;
    if (state.found.has(id)) state.found.delete(id);
    else state.found.add(id);
    saveFound();
    // Touch only the row, never the photos.
    const row = document.querySelector(`#hunt-list .hunt__item[data-id="${CSS.escape(id)}"]`);
    if (row) {
      const on = state.found.has(id);
      row.classList.toggle('is-found', on);
      const btn = row.querySelector('.hunt__mark');
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${plantById(id)?.name || ''}${on ? ', found' : ''}`);
    }
    renderProgress();
    renderHuntDone();
    if (!wasDone && state.found.size === total) buzz();
  }

  function renderHuntDone() {
    if (state.found.size === state.data.species.length) {
      showBanner('found.', `All ${state.found.size} plants on the list.`);
    } else hideBanner();
  }

  // ---- Race (RACE_SIZE targets per racer) --------------------
  function buildRace() {
    $('#race').innerHTML = state.race.map((p, i) => {
      const marked = state.raceMarks.has(p.id);
      return `<div class="cell${marked ? ' is-marked' : ''}" data-race-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(p.name)}${marked ? ', found' : ''}" data-race-mark="${i}">` +
        pictureHtml(`img/thumb/${p.id}`, p.name, 'cell__photo') +
        `<span class="cell__name">${esc(p.short || p.name)}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(p.name)}" data-race-info="${i}">i</button>` +
        `</div>`;
    }).join('');
  }

  function toggleRaceMark(i) {
    const id = state.race[i]?.id;
    if (!id) return;
    if (state.raceMarks.has(id)) state.raceMarks.delete(id);
    else state.raceMarks.add(id);
    const done = state.race.every(p => state.raceMarks.has(p.id));
    const justFinished = done && !state.raceEnd;
    // The finish time is set on the last find and dropped if one is undone.
    if (justFinished) state.raceEnd = Date.now();
    if (!done) state.raceEnd = null;
    persistRace();
    const cell = $(`#race .cell[data-race-index="${i}"]`);
    if (cell) {
      const on = state.raceMarks.has(id);
      cell.classList.toggle('is-marked', on);
      const btn = cell.querySelector('.cell__mark');
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${state.race[i].name}${on ? ', found' : ''}`);
    }
    renderProgress();
    renderRaceDone(justFinished);
  }

  function renderRaceDone(justFinished) {
    if (state.raceEnd && state.race.every(p => state.raceMarks.has(p.id))) {
      showBanner('done.', `All ${RACE_SIZE} found at ${fmtClock(state.raceEnd)}. Compare times: the earlier finish wins.`);
      if (justFinished) buzz();
    } else hideBanner();
  }

  // ---- Detail sheet ------------------------------------------
  // The sheet works for any game: it gets the plant plus how to read and
  // flip that plant's mark in the current game.
  let detail = null;   // { isMarked(), toggle() }
  function openDetail(p, readMark, toggle) {
    if (!p) return;
    detail = { isMarked: readMark, toggle };
    $('#detail-picture').innerHTML =
      `<source srcset="${esc(p.photo)}.webp" type="image/webp">` +
      `<img src="${esc(p.photo)}.jpg" alt="${esc(p.name)}" decoding="async">`;
    $('#detail-category').textContent = p.kind || '';
    $('#detail-name').textContent = p.name;
    $('#detail-binomial').innerHTML = p.various
      ? `<span class="sheet__plain">${esc(p.botanical)}</span>`
      : esc(p.botanical) + (p.alt_botanical ? `<span class="sheet__plain">, also listed as </span>${esc(p.alt_botanical)}` : '');

    const flag = $('#detail-flag');
    if (p.uncertain) { flag.textContent = `Name not confirmed. ${p.uncertain}`; flag.hidden = false; }
    else { flag.textContent = ''; flag.hidden = true; }

    $('#detail-note').textContent = p.fun_fact;
    $('#detail-fact').innerHTML = sourceLine(p);
    $('#detail-credit').innerHTML = creditLine(p);
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
  // "Source: ..." plus the Plant Finder link when it is not already the source.
  function sourceLine(p) {
    let line = `Source: ${p.sources.map(s => link(s.url, s.label)).join(' · ')}`;
    if (p.plantfinder && !p.sources.some(s => s.url === p.plantfinder)) {
      line += ` · ${link(p.plantfinder, 'Missouri Botanical Garden Plant Finder')}`;
    }
    return line;
  }
  function creditLine(p) {
    const credit = p.credit;
    if (!credit || !credit.author) {
      return `<span class="sheet__credit--pending">Photo credit pending. This image is a placeholder until a properly licensed photo is sourced.</span>`;
    }
    const bits = [esc(credit.author)];
    if (credit.license) bits.push(esc(credit.license));
    let line = `Photo: ${bits.join(' · ')}`;
    if (credit.source) line += ` · ${link(credit.source, 'source')}`;
    if (p.photo_note) line += `. ${esc(p.photo_note)}`;
    return line;
  }

  // ---- Marking -----------------------------------------------
  function toggleMark(index) {
    const id = plantAt(index)?.id;
    if (!id) return;
    if (state.marks.has(id)) state.marks.delete(id);
    else state.marks.add(id);
    persist();
    // Touch only the toggled cell, then recompute line rings / banner.
    paintCell(index);
    paintLines();
    renderProgress();
    renderBingo(true);
  }

  // ---- Credits (static per data) -----------------------------
  function renderCredits() {
    $('#credits-list').innerHTML = state.data.species.map(p =>
      `<li><span class="credits__sp">${esc(p.name)}</span> ${creditLine(p)} ${sourceLine(p)}</li>`
    ).join('');
  }

  // ---- Wiring a card -----------------------------------------
  function applyCard(seed, card) {
    state.seed = seed;
    state.card = card;
    state.layout = deal(state.data.species, seed);
    state.marks = loadMarks(seed);
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
  function flipRacer() {
    loadCard(state.seed, state.card === 1 ? 2 : 1, true);
  }

  // New card = new seed. The old card's marks stay saved under its seed,
  // so Back (or its link) brings it back; nothing is lost, no prompt needed.
  function newSeed() {
    loadCard(randomSeed(), 1, true);
    scrollTo({ top: 0, behavior: 'smooth' });
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
      : `This clears ${what} on this card. You cannot undo it.`;
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
      $('#grid').innerHTML = `<p class="loaderr">Could not load the plant list. Check your connection and reload.</p>`;
      return;
    }

    renderCredits();
    state.found = loadIds(HUNT_KEY);

    // Event delegation on the grid.
    $('#grid').addEventListener('click', e => {
      const mark = e.target.closest('[data-mark]');
      if (mark) { toggleMark(Number(mark.dataset.mark)); return; }
      const info = e.target.closest('[data-info]');
      if (info) {
        const i = Number(info.dataset.info);
        openDetail(plantAt(i), () => isMarked(i), () => toggleMark(i));
      }
    });
    $('#hunt').addEventListener('click', e => {
      const mark = e.target.closest('[data-hunt]');
      if (mark) { toggleFound(mark.dataset.hunt); return; }
      const info = e.target.closest('[data-hunt-info]');
      if (info) {
        const id = info.dataset.huntInfo;
        openDetail(plantById(id), () => state.found.has(id), () => toggleFound(id));
      }
    });
    $('#race').addEventListener('click', e => {
      const mark = e.target.closest('[data-race-mark]');
      if (mark) { toggleRaceMark(Number(mark.dataset.raceMark)); return; }
      const info = e.target.closest('[data-race-info]');
      if (info) {
        const i = Number(info.dataset.raceInfo);
        openDetail(state.race[i], () => state.raceMarks.has(state.race[i].id), () => toggleRaceMark(i));
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
    $('#card-toggle').addEventListener('click', flipRacer);

    $('#detail-mark').addEventListener('click', () => {
      detail.toggle();
      syncDetailMark();
    });
    // Tap the dimmed backdrop (outside the drawer) to dismiss it, the way a
    // bottom sheet should close. Escape and the × button close it too.
    $('#detail').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.close();
    });
    $('#new-card').addEventListener('click', newSeed);
    $('#reset').addEventListener('click', askReset);

    // Actions menu: close it after a choice, on an outside click, or on Escape.
    const actionsMenu = $('#actions-menu');
    $('#copy-link').addEventListener('click', async () => {
      const head = $('#copy-link').querySelector('.menu__share-head');
      const label = head.textContent;
      const ok = await copyText(location.href);           // the URL already carries ?s=<seed>[&m=&p=&c=]
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
    $('#confirm-cancel').addEventListener('click', () => $('#confirm-reset').close());
    $('#confirm-yes').addEventListener('click', () => { $('#confirm-reset').close(); resetMarks(); });

    // Back / forward through seeds, racer flips and mode switches.
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
    // card (so the home-screen app resumes); otherwise deal a fresh seed.
    // Mode, pattern and racer resolve the same way. Either way it is
    // written into the URL so it is linkable.
    const url = readUrl();
    const last = loadLast();
    state.mode = url.mode || (MODES.includes(last.mode) ? last.mode : 'bingo');
    state.pattern = url.pattern || (Object.hasOwn(PATTERNS, last.pattern || '') ? last.pattern : 'line');
    if (url.seed) loadCard(url.seed, url.card, false);
    else if (last.seed) loadCard(last.seed, last.card === 2 ? 2 : 1, false);
    else loadCard(randomSeed(), 1, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
