/* =============================================================
   Plant Bingo (/moplants)
   Plain JS, no framework, no service worker. Built to behave like
   the Osa app (../app.js): same seeded deal, seed in the URL, copy
   link, per-seed marks, Actions menu and detail drawer.

   Differences from Osa: every card holds all 25 plants (no FREE
   center, no complementary pair), so a seed deals one card, the
   whole pool in a seeded order.
   ============================================================= */

(() => {
  'use strict';

  const CACHE_NS = 'moplants-bingo:v2';   // localStorage namespace, unique to this game
  const GRID = 25;                        // 5 x 5, no free space

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

  // ---- Persistence (per seed) --------------------------------
  // Marks are stored as plant ids, not cell indices, so they survive
  // any future change to the plant list.
  const marksKey = seed => `${CACHE_NS}:${seed}`;
  const LAST_KEY = `${CACHE_NS}:last`;
  // Remember the current seed so relaunching from the home screen (start_url
  // has no seed) reopens the in-progress card instead of dealing a new one.
  function saveLast(seed) {
    try { localStorage.setItem(LAST_KEY, seed); } catch { /* ignore */ }
  }
  function loadLast() {
    try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
  }
  function loadMarks(seed) {
    try {
      const arr = JSON.parse(localStorage.getItem(marksKey(seed)) || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function persist() {
    try { localStorage.setItem(marksKey(state.seed), JSON.stringify([...state.marks])); }
    catch { /* private mode / blocked storage: card still works this session */ }
  }

  // ---- URL / seed --------------------------------------------
  function randomSeed() {
    // short, shareable token; xmur3 hashes it anyway so any string works
    const n = (crypto?.getRandomValues?.(new Uint32Array(1))[0]) ?? (Math.random() * 2 ** 32);
    return (n >>> 0).toString(36).slice(0, 5).padStart(4, '0');
  }
  function readUrl() {
    return (new URLSearchParams(location.search).get('s') || '').trim();
  }
  function writeUrl(seed, push) {
    const p = new URLSearchParams(location.search);
    p.set('s', seed);
    const url = `${location.pathname}?${p.toString()}`;
    if (push) history.pushState({ seed }, '', url);
    else history.replaceState({ seed }, '', url);
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
  const CHECK = `<svg class="cell__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---- App state ---------------------------------------------
  const state = {
    data: null,       // parsed species.json
    seed: '',
    layout: [],       // all 25 plants, in position order
    marks: new Set(), // spotted plant ids
    lines: 0,         // completed line count last render
  };

  const plantAt = index => state.layout[index] || null;
  const isMarked = index => state.marks.has(plantAt(index)?.id);

  function completedLines() {
    return LINES.filter(line => line.every(isMarked));
  }

  // ---- Rendering ---------------------------------------------
  // buildGrid() rewrites all 25 cells (card load / reset). Marking uses
  // paintCell()/paintLines() to touch only what changed, so a tap never
  // rebuilds the grid or reloads its images.
  function render() {
    buildGrid();
    renderProgress();
    renderBingo(false);
  }

  function buildGrid() {
    const lineCells = new Set(completedLines().flat());
    let html = '';
    for (let i = 0; i < GRID; i++) {
      const p = plantAt(i);
      const marked = isMarked(i);
      const label = p.short || p.name;
      html += `<div class="cell${marked ? ' is-marked' : ''}${lineCells.has(i) ? ' is-line' : ''}" data-index="${i}">` +
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
    $('#progress').textContent = `${state.marks.size} of ${GRID} spotted`;
    $('#seed').textContent = state.seed;
  }

  function renderBingo(justChanged) {
    const banner = $('#bingo-banner');
    const n = completedLines().length;
    if (n === 0) { banner.hidden = true; banner.textContent = ''; state.lines = 0; return; }
    banner.hidden = false;
    let msg;
    if (state.marks.size === GRID) msg = 'Full card. Every plant on the board.';
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
    const p = plantAt(index);
    if (!p) return;
    detailIndex = index;
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
    const marked = isMarked(detailIndex);
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
  function loadCard(seed, push) {
    state.seed = seed;
    state.layout = deal(state.data.species, seed);
    state.marks = loadMarks(seed);
    saveLast(seed);
    writeUrl(seed, push);
    render();
  }

  // New card = new seed. The old card's marks stay saved under its seed,
  // so Back (or its link) brings it back; nothing is lost, no prompt needed.
  function newSeed() {
    loadCard(randomSeed(), true);
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  function askReset() {
    if (state.marks.size === 0) return;            // nothing to clear, no prompt
    const n = state.marks.size;
    $('#confirm-count').textContent = `${n} mark${n === 1 ? '' : 's'}`;
    const dlg = $('#confirm-reset');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function resetMarks() {
    state.marks = new Set();
    persist();
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
      const ok = await copyText(location.href);           // the URL already carries ?s=<seed>
      head.textContent = ok ? 'Link copied' : 'Copy failed — select and copy';
      clearTimeout(head._resetT);
      head._resetT = setTimeout(() => { head.textContent = 'Copy link to this card'; }, 1800);
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

    // Back / forward through seeds.
    window.addEventListener('popstate', () => {
      const seed = readUrl();
      if (seed) {
        state.seed = seed;
        state.layout = deal(state.data.species, seed);
        state.marks = loadMarks(seed);
        saveLast(seed);
        render();
      }
    });

    // Seed resolution: an explicit URL seed wins; otherwise reopen the last
    // card (so the home-screen app resumes); otherwise deal a fresh seed.
    // Either way it is pushed into the URL so it is linkable.
    const seed = readUrl() || loadLast() || randomSeed();
    loadCard(seed, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
