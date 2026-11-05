/* =============================================================
   Bingo core
   Plain JS, no framework, no modules. One app runs every game on
   the site. What differs between games (the list, the deal, the
   words, what is saved and how links read) lives in the game's
   game.json, which the page inlines as <script id="game-config">.

   Needs core/deal.js loaded first (BingoDeal and BingoKeys).

   Three games share the list and the seed:
   - bingo: the 5 x 5 card, with a choice of win pattern
   - hunt:  every item as one checklist for the whole trip
   - race:  each racer gets targets from the seed; first to
            find all of theirs wins
   ============================================================= */

(() => {
  'use strict';

  const cfg = JSON.parse(document.getElementById('game-config').textContent);
  const { deal: dealStrategies, race: raceStrategies } = globalThis.BingoDeal;
  const Keys = globalThis.BingoKeys;

  const GRID = 25;                                  // 5 x 5
  const CENTER = 12;                                // the FREE cell, when a game has one
  const FREE = cfg.freeCentre;
  const POSITIONS = Array.from({ length: GRID }, (_, i) => i).filter(i => !FREE || i !== CENTER);
  const RACE_SIZE = cfg.raceSize;
  const CELLS = cfg.storage.marks === 'cells';      // marks are cell indices, else item ids
  const MSG = cfg.messages;
  const DEFAULT_MODE = cfg.modes[0].id;
  const DEFAULT_PATTERN = cfg.patterns[0].key;

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
  const SHAPES = {
    line: LINES,
    corners: [[0, 4, 20, 24]],
    x: [[0, 6, 12, 18, 24, 4, 8, 16, 20]],
    blackout: [Array.from({ length: GRID }, (_, i) => i)],
  };
  const PATTERNS = Object.fromEntries(cfg.patterns.map(p => [p.key, { ...p, lines: SHAPES[p.shape] }]));

  // ---- Persistence -------------------------------------------
  // What is saved, and under which keys, is on people's phones already:
  // see core/deal.js (BingoKeys) and test/storage.test.mjs.
  const marksKey = (seed, card) => Keys.marks(cfg, seed, card);
  const LAST_KEY = Keys.last(cfg);
  const HUNT_KEY = Keys.hunt(cfg);

  function loadIds(key) {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  // Remember the current card so relaunching the installed app (start_url
  // has no seed) reopens your in-progress card instead of dealing a new one.
  function saveLast() {
    const { seed, card, mode, pattern } = state;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ seed, card, mode, pattern })); } catch { /* ignore */ }
  }
  function loadLast() {
    let raw = null;
    try { raw = localStorage.getItem(LAST_KEY); } catch { return cfg.storage.legacyLast ? {} : null; }
    return Keys.parseLast(cfg, raw);
  }
  function hasSavedMarks(seed, card) {
    try { return localStorage.getItem(marksKey(seed, card)) !== null; }
    catch { return false; }
  }
  // Load saved marks. With a FREE centre the cells format persists its checked
  // flag as CENTER inside the same set; split it out. A brand-new card starts
  // with FREE checked.
  function applySavedMarks(seed, card) {
    const saved = loadIds(marksKey(seed, card));
    if (FREE) {
      state.free = hasSavedMarks(seed, card) ? saved.has(CENTER) : true;
      saved.delete(CENTER);
    }
    state.marks = saved;
  }
  // Persist the marks (and the FREE flag with them).
  function persist() {
    const set = new Set(state.marks);
    if (FREE && state.free) set.add(CENTER);
    try { localStorage.setItem(marksKey(state.seed, state.card), JSON.stringify([...set])); }
    catch { /* private mode / blocked storage: card still works this session */ }
  }

  // Race marks live beside the bingo marks under their own key, with the
  // finish time (epoch ms) kept separately so racers can compare.
  function loadRace(seed, card) {
    state.raceMarks = loadIds(Keys.race(cfg, seed, card));
    try { state.raceEnd = Number(localStorage.getItem(Keys.raceEnd(cfg, seed, card))) || null; }
    catch { state.raceEnd = null; }
  }
  function persistRace() {
    try {
      localStorage.setItem(Keys.race(cfg, state.seed, state.card), JSON.stringify([...state.raceMarks]));
      const k = Keys.raceEnd(cfg, state.seed, state.card);
      if (state.raceEnd) localStorage.setItem(k, String(state.raceEnd));
      else localStorage.removeItem(k);
    } catch { /* ignore */ }
  }

  // The hunt list is one checklist per phone, not per seed: it runs the trip.
  function saveFound() {
    try { localStorage.setItem(HUNT_KEY, JSON.stringify([...state.found])); } catch { /* ignore */ }
  }

  // ---- URL / seed --------------------------------------------
  function randomSeed() {
    // short, shareable token; xmur3 hashes it anyway so any string works
    const n = (crypto?.getRandomValues?.(new Uint32Array(1))[0]) ?? (Math.random() * 2 ** 32);
    return (n >>> 0).toString(36).slice(0, 5).padStart(4, '0');
  }
  const readUrl = () => Keys.readQuery(cfg, location.search);
  function writeUrl(push) {
    const url = `${location.pathname}?${Keys.writeQuery(cfg, location.search, state)}`;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ---- Small helpers -----------------------------------------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
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
  // Which photo a grid cell, hunt row or race cell shows.
  const gridStem = s => (cfg.gridPhoto.variant === 'thumb' ? `${cfg.gridPhoto.dir}${s.id}` : s.photo);
  const cellLabel = s => (cfg.labelField && s[cfg.labelField]) || s.name;

  // ---- App state ---------------------------------------------
  const state = {
    data: null,       // parsed species.json
    seed: '',
    card: 1,          // 1 or 2 (a card pair, or the racer)
    layout: [],       // the items on the current card, in position order
    marks: new Set(), // marked cell indices (0..24) or item ids, per storage.marks; never CENTER
    free: true,       // FREE center checked (tap toggles; it always counts for lines)
    lines: 0,         // completed line count last render
    mode: DEFAULT_MODE,
    pattern: DEFAULT_PATTERN, // key of PATTERNS
    found: new Set(), // hunt: item ids found, across every seed
    huntFilter: 'all',// hunt: category shown, or 'all'
    race: [],         // race: this racer's targets
    raceMarks: new Set(), // race: found target indices or ids, per storage.marks
    raceEnd: null,    // race: when the last target was found (epoch ms)
  };

  // Map a grid cell index -> item (or null for the free center).
  function itemAt(index) {
    if (FREE && index === CENTER) return null;
    return state.layout[POSITIONS.indexOf(index)] || null;
  }
  // What a cell is saved as, and what a race target is saved as.
  const markKey = index => (CELLS ? index : itemAt(index)?.id);
  const raceKey = i => (CELLS ? i : state.race[i]?.id);
  // FREE always counts toward a line, whether or not it is ticked.
  const isMarked = index => (FREE && index === CENTER) || state.marks.has(markKey(index));
  const raceDone = () => state.race.every((_, i) => state.raceMarks.has(raceKey(i)));

  function completedLines() {
    return PATTERNS[state.pattern].lines.filter(line => line.every(isMarked));
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
    // A card pair flips in bingo and race; otherwise only racers flip.
    $('#card-toggle').hidden = cfg.cardPair ? mode === 'hunt' : mode !== 'race';
    $('#copy-link').hidden = mode === 'hunt';
    $('#new-card').hidden = mode === 'hunt';
    $('#new-card').textContent = mode === 'race' ? 'New race' : 'New card';
    $('#copy-link .menu__share-head').textContent = mode === 'race' ? 'Copy link to this race' : 'Copy link to this card';
    $('#mode-hint').textContent =
      mode === 'hunt' ? MSG.hintHunt
      : mode === 'race' ? fill(MSG.hintRace, { raceSize: RACE_SIZE })
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
      if (FREE && i === CENTER) {
        const on = state.free;
        html += `<div class="cell cell--free${on ? ' is-marked' : ''}">` +
          `<button class="cell__mark cell__free-btn" type="button" aria-pressed="${on}" ` +
          `aria-label="Free space${on ? ', marked' : ', tap to mark'}" data-free="1">` +
          `<span class="cell--free__stamp">free.</span>` +
          CHECK +
          `</button></div>`;
        continue;
      }
      const s = itemAt(i);
      if (!s) { html += `<div class="cell cell--empty" aria-hidden="true"></div>`; continue; }
      const marked = isMarked(i);
      const inLine = lineCells.has(i);
      html += `<div class="cell${marked ? ' is-marked' : ''}${inLine ? ' is-line' : ''}${targets.has(i) ? ' is-target' : ''}" data-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(s.name)}${marked ? ', spotted' : ''}" data-mark="${i}">` +
        pictureHtml(gridStem(s), s.name, 'cell__photo') +
        `<span class="cell__name">${esc(cellLabel(s))}</span>` +
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
    const marked = isMarked(i);
    cell.classList.toggle('is-marked', marked);
    const btn = cell.querySelector('.cell__mark');
    if (btn) {
      btn.setAttribute('aria-pressed', String(marked));
      const name = itemAt(i)?.name || '';
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
      const targets = [...patternTargets()].filter(i => !FREE || i !== CENTER);
      if (targets.length) {
        text += ` · ${targets.filter(isMarked).length} of ${targets.length} on the pattern`;
      }
    }
    $('#progress').textContent = text;
    $('#card-toggle').textContent = `${state.mode === 'race' || !cfg.cardPair ? 'Racer' : 'Card'} ${state.card} of 2`;
    $('#seed').textContent = state.seed;
  }

  function renderBingo(justChanged) {
    const n = completedLines().length;
    if (n === 0) { hideBanner(); state.lines = 0; return; }
    let msg = PATTERNS[state.pattern].win;
    if (!msg) {
      if (state.marks.size === POSITIONS.length) msg = MSG.fullCard;
      else if (n === 1) msg = 'That is a line. Bingo.';
      else msg = `${n} full lines now.`;
    }
    showBanner('bingo.', msg);
    if (justChanged && n > state.lines) buzz();
    state.lines = n;
  }

  // ---- Hunt (one checklist of every item) --------------------
  const HUNT = cfg.hunt;
  const categoryLabel = cat => HUNT.categoryLabels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  // Categories in species.json order, so the list reads the way the data does.
  function huntCategories() {
    return [...new Set(state.data.species.map(s => s.category))];
  }
  const itemById = id => state.data.species.find(s => s.id === id) || null;

  function renderHuntFilters() {
    if (HUNT.groupBy !== 'category') return;
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

  function huntSubtitle(s) {
    const sub = HUNT.subtitle;
    const value = s[sub.field];
    if (sub.optional && !value) return '';
    const plain = sub.plainFlag && s[sub.plainFlag];
    return `<span class="hunt__bino${plain ? ' hunt__bino--plain' : ''}">${esc(value)}</span>`;
  }

  function huntRowHtml(s) {
    const found = state.found.has(s.id);
    return `<li class="hunt__item${found ? ' is-found' : ''}" data-id="${esc(s.id)}">` +
      `<button class="hunt__mark" type="button" aria-pressed="${found}" ` +
      `aria-label="${esc(s.name)}${found ? ', found' : ''}" data-hunt="${esc(s.id)}">` +
      pictureHtml(gridStem(s), '', 'hunt__thumb') +
      `<span class="hunt__text"><span class="hunt__name">${esc(s.name)}</span>` +
      huntSubtitle(s) + `</span>` +
      `<span class="hunt__box">${checkSvg('hunt__check')}</span>` +
      `</button>` +
      `<button class="hunt__info" type="button" aria-label="About ${esc(s.name)}" data-hunt-info="${esc(s.id)}">i</button>` +
      `</li>`;
  }

  function buildHunt() {
    renderHuntFilters();
    if (HUNT.groupBy === 'category') {
      const cats = state.huntFilter === 'all' ? huntCategories() : [state.huntFilter];
      $('#hunt-list').innerHTML = cats.map(cat =>
        `<h2 class="hunt__heading">${esc(categoryLabel(cat))}</h2>` +
        `<ul class="hunt__list">` +
        state.data.species.filter(s => s.category === cat).map(huntRowHtml).join('') +
        `</ul>`
      ).join('');
      return;
    }
    const items = [...state.data.species];
    if (HUNT.sortBy === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
    $('#hunt-list').innerHTML = items.map(huntRowHtml).join('');
  }

  function toggleFound(id) {
    const total = state.data.species.length;
    const wasDone = state.found.size === total;
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
      btn.setAttribute('aria-label', `${itemById(id)?.name || ''}${on ? ', found' : ''}`);
    }
    renderHuntFilters();
    renderProgress();
    renderHuntDone();
    if (!wasDone && state.found.size === total) buzz();
  }

  function renderHuntDone() {
    if (state.found.size === state.data.species.length) {
      showBanner('found.', fill(MSG.huntDone, { n: state.found.size, noun: cfg.list.noun }));
    } else hideBanner();
  }

  // ---- Race (RACE_SIZE targets per racer) --------------------
  function buildRace() {
    $('#race').innerHTML = state.race.map((s, i) => {
      const marked = state.raceMarks.has(raceKey(i));
      return `<div class="cell${marked ? ' is-marked' : ''}" data-race-index="${i}">` +
        `<button class="cell__mark" type="button" aria-pressed="${marked}" ` +
        `aria-label="${esc(s.name)}${marked ? ', found' : ''}" data-race-mark="${i}">` +
        pictureHtml(gridStem(s), s.name, 'cell__photo') +
        `<span class="cell__name">${esc(cellLabel(s))}</span>` +
        CHECK +
        `</button>` +
        `<button class="cell__info" type="button" aria-label="About ${esc(s.name)}" data-race-info="${i}">i</button>` +
        `</div>`;
    }).join('');
  }

  function toggleRaceMark(i) {
    const key = raceKey(i);
    if (key === undefined) return;
    if (state.raceMarks.has(key)) state.raceMarks.delete(key);
    else state.raceMarks.add(key);
    const done = raceDone();
    const justFinished = done && !state.raceEnd;
    // The finish time is set on the last find and dropped if one is undone.
    if (justFinished) state.raceEnd = Date.now();
    if (!done) state.raceEnd = null;
    persistRace();
    const cell = $(`#race .cell[data-race-index="${i}"]`);
    if (cell) {
      const on = state.raceMarks.has(key);
      cell.classList.toggle('is-marked', on);
      const btn = cell.querySelector('.cell__mark');
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${state.race[i].name}${on ? ', found' : ''}`);
    }
    renderProgress();
    renderRaceDone(justFinished);
  }

  function renderRaceDone(justFinished) {
    if (state.raceEnd && raceDone()) {
      showBanner('done.', `All ${RACE_SIZE} found at ${fmtClock(state.raceEnd)}. Compare times: the earlier finish wins.`);
      if (justFinished) buzz();
    } else hideBanner();
  }

  // ---- Detail sheet ------------------------------------------
  // The sheet works for any game: it gets the item plus how to read and
  // flip that item's mark in the current game. Which fields feed which
  // line of the sheet is the game's `detail` config.
  const DETAIL = cfg.detail;
  let detail = null;   // { isMarked(), toggle() }
  function openDetail(s, readMark, toggle) {
    if (!s) return;
    detail = { isMarked: readMark, toggle };
    $('#detail-picture').innerHTML =
      `<source srcset="${esc(s.photo)}.webp" type="image/webp">` +
      `<img src="${esc(s.photo)}.jpg" alt="${esc(s.name)}" decoding="async">`;
    $('#detail-category').textContent = s[DETAIL.category] || '';
    $('#detail-name').textContent = s.name;

    const b = DETAIL.binomial;
    const bino = $('#detail-binomial');
    if (b.hideEmpty) {
      bino.textContent = s[b.field] || '';
      bino.hidden = !s[b.field];
    } else {
      const alt = s[b.altField];
      bino.innerHTML = s[b.plainFlag]
        ? `<span class="sheet__plain">${esc(s[b.field])}</span>`
        : esc(s[b.field]) + (alt ? `<span class="sheet__plain">, also listed as </span>${esc(alt)}` : '');
    }

    const c = DETAIL.callout;
    const callout = $(`#${c.id}`);
    if (s[c.field]) { callout.textContent = `${c.prefix}${s[c.field]}`; callout.hidden = false; }
    else { callout.textContent = ''; callout.hidden = true; }

    $('#detail-note').textContent = s[DETAIL.note.field] || '';
    if (DETAIL.fact.sources) $('#detail-fact').innerHTML = sourceLine(s);
    else $('#detail-fact').textContent = s[DETAIL.fact.field] || '';

    $('#detail-credit').innerHTML = creditLine(s);
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
  // "Source: ..." plus one extra link (a plant finder) when it is not already a source.
  function sourceLine(s) {
    let line = `Source: ${s.sources.map(x => link(x.url, x.label)).join(' · ')}`;
    const extra = DETAIL.fact.extraLink;
    if (extra && s[extra.field] && !s.sources.some(x => x.url === s[extra.field])) {
      line += ` · ${link(s[extra.field], extra.label)}`;
    }
    return line;
  }
  function creditLine(s) {
    const credit = s.credit;
    const pending = !credit || (cfg.credits.pending === 'no-author'
      ? !credit.author
      : credit.status === 'unsourced' || (!credit.author && !credit.source));
    if (pending) {
      return `<span class="sheet__credit--pending">Photo credit pending. This image is a placeholder until a properly licensed photo is sourced.</span>`;
    }
    const bits = [];
    if (credit.author) bits.push(esc(credit.author));
    if (credit.license) bits.push(esc(credit.license));
    let line = `Photo: ${bits.join(' · ')}`;
    if (credit.source) line += ` · ${link(credit.source, 'source')}`;
    if (DETAIL.creditNote && s[DETAIL.creditNote]) line += `. ${esc(s[DETAIL.creditNote])}`;
    return line;
  }

  // ---- Marking -----------------------------------------------
  function toggleMark(index) {
    if (FREE && index === CENTER) return;
    const key = markKey(index);
    if (key === undefined) return;
    if (state.marks.has(key)) state.marks.delete(key);
    else state.marks.add(key);
    persist();
    // Touch only the toggled cell, then recompute line rings / banner.
    paintCell(index);
    paintLines();
    renderProgress();
    renderBingo(true);
  }

  // ---- Below-card section + credits (static per data) --------
  function renderSafety() {
    const below = cfg.belowCard;
    $('#safety-list').innerHTML = state.data.safety.map(item => {
      const tag = item.in_pool
        ? `<span class="safety__tag safety__tag--card">${esc(below.tagIn)}</span>`
        : `<span class="safety__tag">${esc(below.tagOut)}</span>`;
      const bino = item.binomial ? ` <em>${esc(item.binomial)}</em>` : '';
      return `<li class="safety__item">` +
        `<p class="safety__name">${esc(item.name)}${bino} ${tag}</p>` +
        `<p class="safety__note">${esc(item.note)}</p>` +
        `</li>`;
    }).join('');
  }
  function renderCredits() {
    $('#credits-list').innerHTML = state.data.species.map(s =>
      `<li><span class="credits__sp">${esc(s.name)}</span> ${creditLine(s)}${cfg.credits.withSources ? ` ${sourceLine(s)}` : ''}</li>`
    ).join('');
  }

  // ---- Wiring a card -----------------------------------------
  function applyCard(seed, card) {
    state.seed = seed;
    state.card = card;
    const cards = dealStrategies[cfg.dealStrategy](state.data.species, seed);
    state.layout = cards[cfg.cardPair ? card - 1 : 0];
    applySavedMarks(seed, card);
    state.race = raceStrategies[cfg.raceStrategy](state.data.species, seed, RACE_SIZE)[card - 1];
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

  // New card = new seed. The old card's marks stay saved under its seed,
  // so Back (or its link) brings it back.
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
      : fill(MSG.resetCardBody, { what, card: state.card });
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
      const res = await fetch(cfg.list.file, { cache: 'no-cache' });
      state.data = await res.json();
    } catch (err) {
      $('#grid').innerHTML = `<p class="loaderr">${esc(MSG.loadError)}</p>`;
      return;
    }

    if (cfg.belowCard) renderSafety();
    renderCredits();
    state.found = loadIds(HUNT_KEY);

    // Event delegation on the grid.
    $('#grid').addEventListener('click', e => {
      const free = e.target.closest('[data-free]');
      if (free) { toggleFree(); return; }
      const mark = e.target.closest('[data-mark]');
      if (mark) { toggleMark(Number(mark.dataset.mark)); return; }
      const info = e.target.closest('[data-info]');
      if (info) {
        const i = Number(info.dataset.info);
        openDetail(itemAt(i), () => isMarked(i), () => toggleMark(i));
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
        openDetail(itemById(id), () => state.found.has(id), () => toggleFound(id));
      }
    });
    $('#race').addEventListener('click', e => {
      const mark = e.target.closest('[data-race-mark]');
      if (mark) { toggleRaceMark(Number(mark.dataset.raceMark)); return; }
      const info = e.target.closest('[data-race-info]');
      if (info) {
        const i = Number(info.dataset.raceInfo);
        openDetail(state.race[i], () => state.raceMarks.has(raceKey(i)), () => toggleRaceMark(i));
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
    $('#copy-link').addEventListener('click', async () => {
      const head = $('#copy-link').querySelector('.menu__share-head');
      const label = head.textContent;
      const ok = await copyText(location.href);           // the URL already carries the seed (and card, mode, pattern)
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

    // Back / forward through seeds, card flips and mode switches.
    window.addEventListener('popstate', () => {
      const url = readUrl();
      if (!url.seed) return;
      state.mode = url.mode || DEFAULT_MODE;
      state.pattern = url.pattern || DEFAULT_PATTERN;
      applyCard(url.seed, url.card);
      saveLast();
      render();
    });

    // Seed resolution: an explicit URL seed wins; otherwise reopen the last
    // card you were on (so the installed app resumes); otherwise deal a fresh
    // seed. Mode and pattern resolve the same way. Either way it is written
    // into the URL so it is linkable.
    const url = readUrl();
    const last = loadLast() || {};
    state.mode = url.mode || (cfg.modes.some(m => m.id === last.mode) ? last.mode : DEFAULT_MODE);
    state.pattern = url.pattern || (Object.hasOwn(PATTERNS, last.pattern || '') ? last.pattern : DEFAULT_PATTERN);
    if (url.seed) loadCard(url.seed, url.card, false);
    else if (last.seed) loadCard(last.seed, last.card === 2 ? 2 : 1, false);
    else loadCard(randomSeed(), 1, false);
  }

  // ---- Service worker (offline games only) -------------------
  if (cfg.offline && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* still works online */ });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
