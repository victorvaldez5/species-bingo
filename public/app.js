/* =============================================================
   Osa Peninsula Wildlife Bingo
   Plain JS, no framework. State is a Set of marked cell indices.

   One seed generates a complementary PAIR of cards:
   the 48 species are partitioned into two non-overlapping 24s
   and each is dealt into fixed grid positions. Two people on the
   same seed hold complementary cards (card 1 and card 2).
   ============================================================= */

(() => {
  'use strict';

  const CACHE_NS = 'osa-bingo:v1';        // localStorage namespace
  const GRID = 25;                        // 5 x 5
  const CENTER = 12;                      // FREE cell index
  const POSITIONS = Array.from({ length: GRID }, (_, i) => i).filter(i => i !== CENTER);

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
  function mulberry32(a) {
    return () => {
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

  // ---- Persistence (per seed + card) -------------------------
  const marksKey = (seed, card) => `${CACHE_NS}:${seed}:c${card}`;
  const LAST_KEY = `${CACHE_NS}:last`;
  // Remember the current card so relaunching the installed app (start_url
  // has no seed) reopens your in-progress card instead of dealing a new one.
  function saveLast(seed, card) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ seed, card })); } catch { /* ignore */ }
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

  // ---- URL / seed --------------------------------------------
  function randomSeed() {
    // short, shareable token; xmur3 hashes it anyway so any string works
    const n = (crypto?.getRandomValues?.(new Uint32Array(1))[0]) ?? (Math.random() * 2 ** 32);
    return (n >>> 0).toString(36).slice(0, 5).padStart(4, '0');
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const s = (p.get('s') || '').trim();
    const c = p.get('c') === '2' ? 2 : 1;
    return { seed: s, card: c };
  }
  function writeUrl(seed, card, push) {
    const p = new URLSearchParams(location.search);
    p.set('s', seed);
    p.set('c', String(card));
    const url = `${location.pathname}?${p.toString()}`;
    if (push) history.pushState({ seed, card }, '', url);
    else history.replaceState({ seed, card }, '', url);
  }

  // ---- Small helpers -----------------------------------------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function pictureHtml(stem, alt, cls) {
    return `<picture>` +
      `<source srcset="${esc(stem)}.webp" type="image/webp">` +
      `<img class="${cls}" src="${esc(stem)}.jpg" alt="${esc(alt)}" decoding="async" draggable="false">` +
      `</picture>`;
  }
  const CHECK = `<svg class="cell__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---- App state ---------------------------------------------
  const state = {
    data: null,       // parsed species.json
    seed: '',
    card: 1,          // 1 or 2
    layout: [],       // 24 species for the current card, in position order
    marks: new Set(), // marked cell indices (0..24), excluding CENTER
    lines: 0,         // completed line count last render
  };

  // Map a grid cell index -> species (or null for the free center).
  function speciesAt(index) {
    if (index === CENTER) return null;
    return state.layout[POSITIONS.indexOf(index)] || null;
  }

  function completedLines() {
    const done = [];
    for (const line of LINES) {
      if (line.every(i => i === CENTER || state.marks.has(i))) done.push(line);
    }
    return done;
  }

  // ---- Rendering ---------------------------------------------
  // buildGrid() rewrites all 25 cells (card load / flip / reset).
  // Marking uses paintCell()/paintLines() to touch only what changed,
  // so a tap never rebuilds the grid or reloads its images.
  function render() {
    buildGrid();
    renderProgress();
    renderBingo(false);
  }

  function buildGrid() {
    const grid = $('#grid');
    const lineCells = new Set(completedLines().flat());
    let html = '';
    for (let i = 0; i < GRID; i++) {
      if (i === CENTER) {
        html += `<div class="cell cell--free" aria-label="Free space, already marked">` +
          `<span class="cell--free__stamp">free.</span></div>`;
        continue;
      }
      const s = speciesAt(i);
      if (!s) { html += `<div class="cell cell--empty" aria-hidden="true"></div>`; continue; }
      const marked = state.marks.has(i);
      const inLine = lineCells.has(i);
      html += `<div class="cell${marked ? ' is-marked' : ''}${inLine ? ' is-line' : ''}" data-index="${i}">` +
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

  function renderProgress() {
    $('#progress').textContent = `${state.marks.size} of ${POSITIONS.length} spotted`;
    const toggle = $('#card-toggle');
    toggle.textContent = `Card ${state.card} of 2`;
    $('#seed').textContent = state.seed;
  }

  function renderBingo(justChanged) {
    const banner = $('#bingo-banner');
    const done = completedLines();
    const n = done.length;
    const blackout = state.marks.size === POSITIONS.length;
    if (n === 0) { banner.hidden = true; banner.textContent = ''; state.lines = 0; return; }
    banner.hidden = false;
    let msg;
    if (blackout) msg = 'Full card. Every cell on the board.';
    else if (n === 1) msg = 'That is a line. Bingo.';
    else msg = `${n} full lines now.`;
    banner.innerHTML = `<span class="bingo-banner__stamp">bingo.</span> <span>${esc(msg)}</span>`;
    if (justChanged && n > state.lines && 'vibrate' in navigator) {
      try { navigator.vibrate(30); } catch { /* not supported */ }
    }
    state.lines = n;
  }

  // ---- Detail sheet ------------------------------------------
  let detailIndex = null;
  function openDetail(index) {
    const s = speciesAt(index);
    if (!s) return;
    detailIndex = index;
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
    const marked = state.marks.has(detailIndex);
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
    saveMarks(state.seed, state.card, state.marks);
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
  function loadCard(seed, card, push) {
    state.seed = seed;
    state.card = card;
    const rng = makeRng(seed);
    const pair = deal(state.data.species, rng);
    state.layout = pair[card - 1];
    state.marks = loadMarks(seed, card);
    saveLast(seed, card);
    writeUrl(seed, card, push);
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
    if (state.marks.size === 0) return;            // nothing to clear, no prompt
    const n = state.marks.size;
    $('#confirm-count').textContent = `${n} mark${n === 1 ? '' : 's'}`;
    $('#confirm-card').textContent = String(state.card);
    const dlg = $('#confirm-reset');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function resetMarks() {
    state.marks = new Set();
    saveMarks(state.seed, state.card, state.marks);
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

    // Event delegation on the grid.
    $('#grid').addEventListener('click', e => {
      const mark = e.target.closest('[data-mark]');
      if (mark) { toggleMark(Number(mark.dataset.mark)); return; }
      const info = e.target.closest('[data-info]');
      if (info) { openDetail(Number(info.dataset.info)); }
    });

    $('#detail-mark').addEventListener('click', () => {
      toggleMark(detailIndex);
      syncDetailMark();
    });
    $('#card-toggle').addEventListener('click', flipCard);
    $('#new-card').addEventListener('click', newSeed);
    $('#reset').addEventListener('click', askReset);
    $('#confirm-cancel').addEventListener('click', () => $('#confirm-reset').close());
    $('#confirm-yes').addEventListener('click', () => { $('#confirm-reset').close(); resetMarks(); });

    // Back / forward through seeds and card flips.
    window.addEventListener('popstate', () => {
      const { seed, card } = readUrl();
      if (seed) { state.seed = seed; state.card = card;
        const pair = deal(state.data.species, makeRng(seed));
        state.layout = pair[card - 1];
        state.marks = loadMarks(seed, card);
        render();
      }
    });

    // Seed resolution: an explicit URL seed wins; otherwise reopen the last
    // card you were on (so the installed app resumes offline); otherwise deal
    // a fresh seed. Either way it is pushed into the URL so it is linkable.
    const url = readUrl();
    if (url.seed) loadCard(url.seed, url.card, false);
    else {
      const last = loadLast();
      if (last && last.seed) loadCard(last.seed, last.card === 2 ? 2 : 1, false);
      else loadCard(randomSeed(), 1, false);
    }
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
