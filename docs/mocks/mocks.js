// Fills the repeated parts of the mocks. Mock-only; not app code.
(() => {
  const OSA = [
    ['Scarlet Macaw', 'scarlet-macaw'], ['White-faced Capuchin', 'white-faced-capuchin'],
    ['Mantled Howler Monkey', 'mantled-howler-monkey'], ['Three-toed Sloth', 'three-toed-sloth'],
    ['Chestnut-mandibled Toucan', 'chestnut-mandibled-toucan'], ['Great Curassow', 'great-curassow'],
    ['White-nosed Coati', 'white-nosed-coati'], ['Blue Morpho Butterfly', 'blue-morpho-butterfly'],
    ['Red-eyed Tree Frog', 'red-eyed-tree-frog'], ['Leafcutter Ants', 'leafcutter-ants'],
    ['American Crocodile', 'american-crocodile'], ['Green Iguana', 'green-iguana'],
    ['King Vulture', 'king-vulture'], ['Golfo Dulce Poison Frog', 'golfo-dulce-poison-frog'],
    ['Collared Peccary', 'collared-peccary'], ['Basilisk Lizard', 'basilisk-lizard'],
    ["Baird's Tapir", 'bairds-tapir'], ['Central American Squirrel Monkey', 'central-american-squirrel-monkey'],
    ['Neotropical River Otter', 'neotropical-river-otter'], ['Mangrove Tree Crab', 'mangrove-tree-crab'],
    ['Ringed Kingfisher', 'ringed-kingfisher'], ['Northern Jacana', 'northern-jacana'],
    ['Halloween Moon Crab', 'halloween-moon-crab'], ['Bare-throated Tiger-Heron', 'bare-throated-tiger-heron'],
  ].map(([n, id]) => [n, `../../public/img/${id}.webp`]);
  const PLANTS = [
    ['Pink Lemonade', 'pink-lemonade'], ['Bottlebrush Buckeye', 'bottlebrush-buckeye'], ['St. Johnswort', 'st-johnwort'],
    ['Pretty in Pink Epimedium', 'pretty-in-pink-epimedium'], ['Korean Feather Reed Grass', 'korean-feather-reed-grass'],
    ['New Jersey Tea', 'new-jersey-tea'], ['Girard Azalea', 'girard-azalea'], ['Hillside Black Beauty Bugbane', 'hillside-black-beauty-actaea'],
    ['Sugar Shack Buttonbush', 'sugar-shack-buttonbush'], ['Sweet Woodruff', 'sweet-woodruff'], ['Emerald Spreader Yew', 'emerald-spreader-yew'],
    ['Lipstick Hosta', 'lipstick-hosta'], ['Short-beak Sedge', 'short-beak-sedge'], ['Yellowwood', 'yellowwood'],
    ['Paperbark Maple', 'paperbark-maple'], ['Espalier or Topiary', 'espalier-topiary'], ['Weeping Tree', 'weeping-tree'],
    ['Elderberry', 'elderberry'], ['Cardinal Flower', 'cardinal-flower'], ['Thunderhead Japanese Black Pine', 'thunderhead-black-pine'],
    ['Arnold Columnar Tulip Tree', 'arnold-tulip-tree'], ['Fireworks Goldenrod', 'fireworks-goldenrod'],
    ['Storm Cloud Bluestar', 'storm-cloud-amsonia'], ['Lemon Purrfection Catmint', 'lemon-perfection-catmint'], ['Hummelo Betony', 'hummelo-stachys'],
  ].map(([n, id]) => [n, `../../public/moplants/img/${id}.webp`]);

  const CHECK = '<svg class="cell__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const nums = s => new Set((s || '').split(',').filter(Boolean).map(Number));
  const $$ = sel => document.querySelectorAll(sel);

  // Cards: Osa has a free centre (index 12), plants fill all 25.
  for (const el of $$('[data-grid]')) {
    const osa = el.dataset.grid === 'osa';
    const list = osa ? OSA : PLANTS;
    const marked = nums(el.dataset.marked), line = nums(el.dataset.line), noimg = nums(el.dataset.noimg);
    let html = '', k = 0;
    for (let i = 0; i < 25; i++) {
      if (osa && i === 12) { html += `<div class="cell cell--free${line.has(i) ? ' is-line' : ''}"><span>free.</span></div>`; continue; }
      const [name, src] = list[k++];
      const cls = ['cell', marked.has(i) && 'is-marked', line.has(i) && 'is-line', noimg.has(i) && 'cell--noimg'].filter(Boolean).join(' ');
      html += `<div class="${cls}">` + (noimg.has(i) ? '' : `<img src="${src}" alt="">`) +
        `<span class="cell__name">${name}</span>${CHECK}<span class="cell__i">i</span></div>`;
    }
    el.innerHTML = html;
  }
  for (const el of $$('[data-skel]')) {
    el.innerHTML = Array.from({ length: 25 }, (_, i) => `<div class="cell cell--skel${i === 12 ? ' cell--free' : ''}"></div>`).join('');
  }

  for (const el of $$('[data-strip]')) {
    const list = el.dataset.strip === 'osa' ? [OSA[0], OSA[7], OSA[8], OSA[3], OSA[4]] : [PLANTS[18], PLANTS[0], PLANTS[22], PLANTS[1], PLANTS[11]];
    el.innerHTML = list.map(([, s]) => `<img src="${s}" alt="">`).join('');
  }
  for (const el of $$('[data-og]')) {
    const pick = [OSA[0], OSA[8], OSA[7], OSA[3], null, OSA[4]];
    el.innerHTML = pick.map(p => p ? `<img src="${p[1]}" alt="">` : '<div class="free">free.</div>').join('');
  }

  for (const el of $$('[data-bar]')) {
    el.outerHTML = `<header class="bar"><button class="bar__back" aria-label="All games">‹</button>` +
      `<h1 class="bar__title">${el.dataset.bar}</h1><button class="bar__menu">Actions ▾</button></header>`;
  }
  for (const el of $$('[data-modes]')) {
    const m = el.dataset.modes;
    el.outerHTML = `<div class="modes" role="group">` +
      ['Bingo', 'Hunt', 'Race'].map(x => `<button aria-pressed="${x.toLowerCase() === m}">${x}</button>`).join('') + `</div>`;
  }
  for (const el of $$('[data-rows]')) {
    const birds = [OSA[0], OSA[4], OSA[5], OSA[12], OSA[20], OSA[21]];
    el.innerHTML = birds.map(([n, s]) => `<div class="row"><img src="${s}" alt=""><strong>${n}</strong><i></i></div>`).join('');
  }

  const SHAPES = {
    line: ['Any line', 'Fill any row, column or diagonal.', [10, 11, 12, 13, 14]],
    corners: ['Four corners', 'Spot the four species in the corners.', [0, 4, 20, 24]],
    x: ['Big X', 'Fill both diagonals.', [0, 6, 12, 18, 24, 4, 8, 16, 20]],
    blackout: ['Blackout', 'Spot all 24 species on your card.', Array.from({ length: 25 }, (_, i) => i)],
  };
  for (const el of $$('[data-patterns]')) {
    const sel = el.dataset.patterns;
    el.innerHTML = Object.entries(SHAPES).map(([k, [label, hint, cells]]) => {
      const on = new Set(cells);
      const mini = Array.from({ length: 25 }, (_, i) => `<i class="${i === 12 ? 'fr' : on.has(i) ? 'on' : ''}"></i>`).join('');
      return `<button class="pat" aria-pressed="${k === sel}"><span class="pat__mini">${mini}</span>` +
        `<span><strong>${label}</strong><span>${hint}</span></span></button>`;
    }).join('');
  }

  for (const el of $$('[data-foot]')) {
    const game = el.dataset.game;
    el.innerHTML = `<nav class="foot__links"><a href="#">How to play</a><a href="#">About</a>` +
      `<a href="#">Credits</a><a href="#">Privacy</a>${game ? '<a href="#">All games</a>' : ''}</nav>` +
      `<div class="foot__maker">made by<span class="wnd-logo" style="--logo-size: 18px" aria-label="Wild and Native Gardens">` +
      `<span class="wnd-logo__row">Wild <em>&amp;</em> Native</span><span class="wnd-logo__sub"><span>Gardens</span></span></span></div>`;
  }

  // Theme switch, same storage key the plan specifies.
  const root = document.documentElement;
  const sync = () => {
    const t = root.dataset.theme || 'auto';
    for (const b of $$('#theme button')) b.setAttribute('aria-pressed', String(b.dataset.t === t));
  };
  document.getElementById('theme').addEventListener('click', e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (!t) return;
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    try { if (t === 'auto') localStorage.removeItem('species-bingo:theme'); else localStorage.setItem('species-bingo:theme', t); } catch { /* ignore */ }
    sync();
  });
  sync();
})();
