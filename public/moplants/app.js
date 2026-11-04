/* =============================================================
   Plant Bingo (/moplants)
   Plain JS, no framework, no service worker. Self-contained:
   nothing here is shared with the Osa app at the site root.

   Every card holds all 25 plants (no free space) in a shuffled
   order. State is the order plus a Set of found plant ids, saved
   in localStorage under a key only this game uses.
   ============================================================= */

(() => {
  'use strict';

  const STORE_KEY = 'moplants-bingo:v1';      // { order: [ids], found: [ids] }
  const THEME_KEY = 'moplants-bingo:theme';   // 'auto' | 'light' | 'dark'
  const SIZE = 5;
  const GRID = SIZE * SIZE;

  // Winning lines: 5 rows, 5 cols, 2 diagonals (cell indices 0..24).
  const LINES = (() => {
    const lines = [];
    const r5 = [0, 1, 2, 3, 4];
    for (let r = 0; r < SIZE; r++) lines.push(r5.map(c => r * SIZE + c));
    for (let c = 0; c < SIZE; c++) lines.push(r5.map(r => r * SIZE + c));
    lines.push(r5.map(i => i * SIZE + i));
    lines.push(r5.map(i => i * SIZE + (SIZE - 1 - i)));
    return lines;
  })();

  // ---- Small helpers -----------------------------------------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function randomInt(n) {
    if (crypto?.getRandomValues) {
      // rejection sampling keeps the shuffle unbiased
      const max = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= max);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function pictureHtml(stem, alt, cls) {
    return `<picture>` +
      `<source srcset="${esc(stem)}.webp" type="image/webp">` +
      `<img class="${cls}" src="${esc(stem)}.jpg" alt="${esc(alt)}" decoding="async" draggable="false">` +
      `</picture>`;
  }
  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  const CHECK = `<svg class="cell__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---- State -------------------------------------------------
  const state = {
    plants: [],          // from species.json
    byId: new Map(),
    order: [],           // 25 plant ids, in grid position order
    found: new Set(),    // found plant ids
    lines: 0,            // completed line count at last render
  };

  // ---- Persistence -------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ order: state.order, found: [...state.found] }));
    } catch { /* private mode / blocked storage: the card still works this session */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
  }
  // A saved order is reused only if it is exactly the current 25 plants, so
  // editing species.json later never leaves a broken or partial card.
  function restoreOrDeal() {
    const saved = load();
    const ids = state.plants.map(p => p.id);
    const valid = saved && Array.isArray(saved.order) && saved.order.length === ids.length &&
      ids.every(id => saved.order.includes(id));
    if (valid) {
      state.order = saved.order.slice();
      state.found = new Set((saved.found || []).filter(id => state.byId.has(id)));
    } else {
      state.order = shuffle(ids.slice());
      state.found = new Set();
      save();
    }
  }

  // ---- Lines -------------------------------------------------
  function completedLines() {
    return LINES.filter(line => line.every(i => state.found.has(state.order[i])));
  }

  // ---- Rendering ---------------------------------------------
  // buildGrid() writes all 25 cells (load / new card / clear). A tap only
  // repaints its own cell and the line rings, so images never reload.
  function buildGrid() {
    let html = '';
    for (let i = 0; i < GRID; i++) {
      const p = state.byId.get(state.order[i]);
      const found = state.found.has(p.id);
      html += `<div class="cell${found ? ' is-marked' : ''}" data-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${found}" ` +
        `aria-label="${esc(p.name)}${found ? ', found' : ''}" data-mark="${i}">` +
        pictureHtml(`img/thumb/${p.id}`, '', 'cell__photo') +
        `<span class="cell__name">${esc(p.short || p.name)}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(p.name)}" data-info="${i}">i</button>` +
        `</div>`;
    }
    $('#grid').innerHTML = html;
    paintLines();
  }

  function paintCell(i) {
    const cell = $(`#grid .cell[data-index="${i}"]`);
    if (!cell) return;
    const p = state.byId.get(state.order[i]);
    const found = state.found.has(p.id);
    cell.classList.toggle('is-marked', found);
    const btn = cell.querySelector('.cell__mark');
    btn.setAttribute('aria-pressed', String(found));
    btn.setAttribute('aria-label', `${p.name}${found ? ', found' : ''}`);
  }

  function paintLines() {
    const lineCells = new Set(completedLines().flat());
    for (const cell of document.querySelectorAll('#grid .cell')) {
      cell.classList.toggle('is-line', lineCells.has(Number(cell.dataset.index)));
    }
  }

  function renderProgress() {
    $('#progress').textContent = `${state.found.size} of ${GRID} found`;
  }

  function renderBingo(justChanged) {
    const banner = $('#bingo-banner');
    const n = completedLines().length;
    if (n === 0) { banner.hidden = true; banner.textContent = ''; state.lines = 0; return; }
    banner.hidden = false;
    let msg;
    if (state.found.size === GRID) msg = 'Full card. You found every plant.';
    else if (n === 1) msg = 'That is a line. Bingo.';
    else msg = `${n} lines now.`;
    banner.innerHTML = `<span class="bingo-banner__stamp">bingo.</span> <span>${esc(msg)}</span>`;
    if (justChanged && n > state.lines && 'vibrate' in navigator) {
      try { navigator.vibrate(30); } catch { /* not supported */ }
    }
    state.lines = n;
  }

  function render() {
    buildGrid();
    renderProgress();
    renderBingo(false);
  }

  // ---- Detail sheet ------------------------------------------
  let detailIndex = null;
  function sourceLinks(p) {
    const links = p.sources.map(s =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`);
    let html = `<span class="sheet__label">Source</span> ${links.join(' · ')}`;
    const inSources = p.sources.some(s => s.url === p.plantfinder);
    if (p.plantfinder && !inSources) {
      html += `<br><a href="${esc(p.plantfinder)}" target="_blank" rel="noopener">Look it up on Missouri Botanical Garden Plant Finder</a>`;
    }
    return html;
  }
  function creditLine(c) {
    if (!c || !c.author) return `<span class="sheet__credit--pending">Photo credit pending. This image is a placeholder.</span>`;
    const lic = c.license_url
      ? `<a href="${esc(c.license_url)}" target="_blank" rel="noopener">${esc(c.license)}</a>`
      : esc(c.license);
    return `Photo: ${esc(c.author)} · ${lic} · <a href="${esc(c.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
  }
  function openDetail(index) {
    const p = state.byId.get(state.order[index]);
    if (!p) return;
    detailIndex = index;
    $('#detail-picture').innerHTML =
      `<source srcset="${esc(p.photo)}.webp" type="image/webp">` +
      `<img src="${esc(p.photo)}.jpg" alt="${esc(p.name)}" decoding="async">`;
    const note = $('#detail-photo-note');
    note.textContent = p.photo_note || '';
    note.hidden = !p.photo_note;
    $('#detail-kind').textContent = p.kind || '';
    $('#detail-name').textContent = p.name;
    $('#detail-botanical').innerHTML = p.various
      ? `<span class="sheet__various">${esc(p.botanical)}</span>`
      : `<i>${esc(p.botanical)}</i>` + (p.alt_botanical ? ` <span class="sheet__alt">also listed as <i>${esc(p.alt_botanical)}</i></span>` : '');
    const flag = $('#detail-uncertain');
    if (p.uncertain) { flag.innerHTML = `<strong>Name not confirmed.</strong> ${esc(p.uncertain)}`; flag.hidden = false; }
    else { flag.textContent = ''; flag.hidden = true; }
    $('#detail-fact').textContent = p.fun_fact;
    $('#detail-sources').innerHTML = sourceLinks(p);
    $('#detail-credit').innerHTML = creditLine(p.credit);
    syncDetailMark();
    openDialog($('#detail'));
  }
  function syncDetailMark() {
    const btn = $('#detail-mark');
    const found = state.found.has(state.order[detailIndex]);
    btn.textContent = found ? 'Found. Tap to undo.' : 'Mark as found';
    btn.classList.toggle('is-marked', found);
    btn.setAttribute('aria-pressed', String(found));
  }

  // ---- Actions -----------------------------------------------
  function toggleMark(index) {
    const id = state.order[index];
    if (state.found.has(id)) state.found.delete(id);
    else state.found.add(id);
    save();
    paintCell(index);
    paintLines();
    renderProgress();
    renderBingo(true);
  }
  function newCard() {
    state.order = shuffle(state.order.slice());
    state.found = new Set();
    save();
    render();
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearMarks() {
    state.found = new Set();
    save();
    render();
  }

  // One confirm dialog serves both destructive actions. With nothing found
  // yet there is nothing to lose, so act without asking.
  let pending = null;
  function confirmThen(kind) {
    const run = kind === 'new' ? newCard : clearMarks;
    if (state.found.size === 0) { run(); return; }
    const n = state.found.size;
    $('#confirm-title').textContent = kind === 'new' ? 'Start a new card?' : 'Clear your marks?';
    $('#confirm-body').textContent = `This clears ${n} found plant${n === 1 ? '' : 's'}${kind === 'new' ? ' and shuffles the card' : ''}. You cannot undo it.`;
    $('#confirm-yes').textContent = kind === 'new' ? 'New card' : 'Clear marks';
    pending = run;
    openDialog($('#confirm'));
  }

  // ---- Theme -------------------------------------------------
  // 'auto' follows the phone's setting. A manual choice helps outdoors,
  // where light mode in direct sun can beat a dark system theme.
  const THEMES = ['auto', 'light', 'dark'];
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#theme').textContent = `Theme: ${t}`;
  }
  function loadTheme() {
    try { const t = localStorage.getItem(THEME_KEY); return THEMES.includes(t) ? t : 'auto'; } catch { return 'auto'; }
  }
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(loadTheme()) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
  }

  // ---- Credits list (static per data) ------------------------
  function renderCredits() {
    $('#credits-list').innerHTML = state.plants.map(p =>
      `<li><span class="credits__sp">${esc(p.name)}</span> ${creditLine(p.credit)}` +
      (p.photo_note ? ` <span class="credits__note">${esc(p.photo_note)}</span>` : '') +
      `<br><span class="credits__src">Fact: ${p.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ')}</span></li>`
    ).join('');
  }

  // ---- Init --------------------------------------------------
  async function init() {
    applyTheme(loadTheme());
    try {
      const res = await fetch('species.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.plants = data.species;
      state.byId = new Map(state.plants.map(p => [p.id, p]));
    } catch {
      $('#grid').innerHTML = `<p class="loaderr">Could not load the plant list. Check your connection and reload.</p>`;
      return;
    }
    restoreOrDeal();
    render();
    renderCredits();

    $('#grid').addEventListener('click', e => {
      const mark = e.target.closest('[data-mark]');
      if (mark) { toggleMark(Number(mark.dataset.mark)); return; }
      const info = e.target.closest('[data-info]');
      if (info) openDetail(Number(info.dataset.info));
    });
    $('#detail-mark').addEventListener('click', () => { toggleMark(detailIndex); syncDetailMark(); });
    // Tap the dimmed backdrop to dismiss the sheet; Escape and × close it too.
    $('#detail').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

    const menu = $('#actions-menu');
    $('#new-card').addEventListener('click', () => { menu.open = false; confirmThen('new'); });
    $('#reset').addEventListener('click', () => { menu.open = false; confirmThen('clear'); });
    $('#theme').addEventListener('click', cycleTheme);   // menu stays open so the label change shows
    document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) menu.open = false; });

    $('#confirm-cancel').addEventListener('click', () => { pending = null; $('#confirm').close(); });
    $('#confirm-yes').addEventListener('click', () => {
      $('#confirm').close();
      const run = pending; pending = null;
      if (run) run();
    });

    // Another tab of this game changed the card: follow it.
    window.addEventListener('storage', e => {
      if (e.key === STORE_KEY) { restoreOrDeal(); render(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
