#!/usr/bin/env node
/* =============================================================
   build-manifest.mjs
   Validation gate + service-worker precache generator.
   NODE BUILT-INS ONLY (runs in CI, must stay cheap).

   Exits non-zero on any structural failure. This is the script
   that stops you adding a species, forgetting its photo, and
   finding out while offline in a rainforest.

   The two HTML entries ('./' and index.html) are hashed from the
   built dist/index.html (Astro output); everything else is read
   from public/. Run `astro build` first (npm run build does).
   After rewriting public/sw.js the script copies it to dist/sw.js.

   Flags:
     --dry-run   validate data only, write nothing, needs no dist/
                 (npm run check)
   ============================================================= */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const DIST_INDEX = join(DIST, 'index.html');
const IMG = join(PUBLIC, 'img');
const FONTS = join(PUBLIC, 'fonts');
const SW = join(PUBLIC, 'sw.js');
const DIST_SW = join(DIST, 'sw.js');
const SPECIES = join(PUBLIC, 'species.json');

const DRY = process.argv.includes('--dry-run');
const REQUIRED = ['id', 'name', 'category', 'photo', 'id_note', 'fun_fact', 'credit'];
const CATEGORIES = new Set(['mammal', 'bird', 'reptile', 'amphibian', 'invertebrate', 'plant', 'marine']);
const EXPECTED_COUNT = 48;

const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

// ---- Load species.json -------------------------------------
let data;
try {
  data = JSON.parse(readFileSync(SPECIES, 'utf8'));
} catch (e) {
  console.error(`✗ Could not read/parse public/species.json: ${e.message}`);
  process.exit(1);
}
const species = Array.isArray(data.species) ? data.species : [];

// Placeholders written by optimize-images.mjs (which ids are not real photos yet).
let placeholders = new Set();
const phFile = join(IMG, '.placeholders.json');
if (existsSync(phFile)) {
  try { placeholders = new Set(JSON.parse(readFileSync(phFile, 'utf8'))); } catch { /* ignore */ }
}

// ---- Structural validation ---------------------------------
if (species.length !== EXPECTED_COUNT) {
  err(`Expected exactly ${EXPECTED_COUNT} species, found ${species.length}.`);
}

const seen = new Set();
for (const s of species) {
  const label = s.id || s.name || '(unnamed)';
  for (const f of REQUIRED) {
    if (!(f in s) || s[f] === undefined || s[f] === null || s[f] === '') {
      err(`[${label}] missing required field "${f}".`);
    }
  }
  if (!s.id) continue;
  if (seen.has(s.id)) err(`Duplicate id "${s.id}".`);
  seen.add(s.id);

  if (!/^[a-z0-9-]+$/.test(s.id)) err(`[${s.id}] id must be kebab-case (a-z, 0-9, hyphen).`);
  if (s.category && !CATEGORIES.has(s.category)) err(`[${s.id}] unknown category "${s.category}".`);
  if (s.photo !== `img/${s.id}`) err(`[${s.id}] photo stem "${s.photo}" must equal "img/${s.id}".`);

  // Both variants must exist on disk, or offline breaks for whichever the browser picks.
  for (const ext of ['webp', 'jpg']) {
    const p = join(PUBLIC, `${s.photo}.${ext}`);
    if (!existsSync(p)) err(`[${s.id}] photo missing on disk: ${s.photo}.${ext}`);
  }

  // Credit / license: a legal requirement once a real photo ships.
  const c = s.credit || {};
  const unsourced = c.status === 'unsourced' || (!c.author && !c.source);
  if (unsourced) {
    if (placeholders.has(s.id)) warn(`[${s.id}] placeholder image, credit still pending.`);
    else err(`[${s.id}] real photo present but credit/license is empty. CC-BY attribution is required to ship.`);
  }
}

// ---- Orphan images -----------------------------------------
const referenced = new Set();
for (const s of species) { referenced.add(`${s.id}.webp`); referenced.add(`${s.id}.jpg`); }
if (existsSync(IMG)) {
  for (const f of readdirSync(IMG)) {
    if (!/\.(webp|jpg)$/i.test(f)) continue;           // skip subdirs, .placeholders.json, etc.
    if (!referenced.has(f)) err(`Orphan image in public/img/ that nothing references: ${f}`);
  }
}

// ---- Report validation -------------------------------------
console.log(`\nOsa Bingo · manifest ${DRY ? 'check' : 'build'}`);
console.log(`  species: ${species.length}  ·  placeholders: ${placeholders.size}  ·  real photos: ${species.length - placeholders.size}`);
for (const w of warnings) console.log(`  ! ${w}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}
console.log(`  ✓ structure valid`);

// ---- Build the precache list -------------------------------
const fontFiles = existsSync(FONTS)
  ? readdirSync(FONTS).filter(f => /\.(woff2|woff|ttf)$/i.test(f)).sort().map(f => `fonts/${f}`)
  : [];
const iconFiles = ['img/icons/icon-192.png', 'img/icons/icon-512.png', 'img/icons/icon-maskable-512.png']
  .filter(p => existsSync(join(PUBLIC, p)));
const photoFiles = species.flatMap(s => [`${s.photo}.webp`, `${s.photo}.jpg`]).sort();

const precache = [
  './',
  'index.html',
  'core/deal.js',
  'core/bingo.js',
  'core/styles.css',
  'tokens.css',
  'species.json',
  'manifest.webmanifest',
  ...fontFiles,
  ...iconFiles,
  ...photoFiles,
];

// BUILD hash: fingerprint of every precached file's bytes, so any
// asset change yields a new cache name and the SW update lands.
// The HTML entry comes from the Astro build, the rest from public/.
if (!DRY && !existsSync(DIST_INDEX)) {
  console.error('✗ dist/index.html not found. Run `npm run build` (astro build first), not this script alone.');
  process.exit(1);
}
const hash = createHash('sha256');
for (const rel of precache) {
  if (rel === './') continue;
  const p = rel === 'index.html' ? DIST_INDEX : join(PUBLIC, rel);
  if (existsSync(p)) hash.update(rel).update(readFileSync(p));
}
const build = hash.digest('hex').slice(0, 10);

if (fontFiles.length === 0) warn('no font files found in public/fonts — run `npm run fonts`.');
if (iconFiles.length < 3) warn(`only ${iconFiles.length}/3 PWA icons present — run \`npm run images\`.`);

// ---- Rewrite sw.js -----------------------------------------
const sw = readFileSync(SW, 'utf8');
if (!sw.includes('// BEGIN-PRECACHE') || !sw.includes('// END-PRECACHE')) {
  console.error('✗ sw.js is missing the // BEGIN-PRECACHE / // END-PRECACHE markers.');
  process.exit(1);
}

const block = precache.map(p => `  '${p}',`).join('\n');
const next = sw
  .replace(/(\/\/ BEGIN-PRECACHE)[\s\S]*?(\s*\/\/ END-PRECACHE)/,
           `$1\n${block}\n  // END-PRECACHE`)
  .replace(/const BUILD = '[^']*';/, `const BUILD = '${build}';`);

const changed = next !== sw;
const VERSION = (sw.match(/const VERSION = '([^']*)'/) || [])[1] || '?';

console.log(`  precache entries: ${precache.length}  ·  build hash: ${build}${changed ? '' : ' (unchanged)'}`);

// ---- CREDITS.md (kept in sync with species.json) -----------
function writeCredits() {
  const rows = species.map(s => {
    const c = s.credit || {};
    let status;
    if (placeholders.has(s.id)) status = '_placeholder — licensed photo pending_';
    else if (c.author || c.source) {
      const bits = [c.author, c.license].filter(Boolean).join(', ');
      status = c.source ? `${bits} — <${c.source}>` : bits;
    } else status = '**MISSING CREDIT**';
    return `| ${s.name} | _${s.binomial || ''}_ | ${status} |`;
  }).join('\n');
  const pending = placeholders.size;
  const md = `# Photo credits

Every photo on this public site must carry its author, license and source.
CC-BY and CC-BY-SA are attribution licenses, so this is a legal requirement,
not a courtesy. This file is generated from \`public/species.json\` by
\`scripts/build-manifest.mjs\` — edit the \`credit\` block there, not here.

**Status: ${species.length - pending} of ${species.length} sourced, ${pending} pending.**
Photos are public-domain or CC-licensed only (Wikimedia Commons, iNaturalist
CC-BY/CC0, Flickr Creative Commons). No all-rights-reserved images. If no
decently licensed photo exists for a species, it is flagged, never swapped for
a lookalike — a mislabeled fer-de-lance is a safety problem, not a cosmetic one.

| Species | Binomial | Credit |
|---|---|---|
${rows}

## Fonts

Playfair Display, Nunito Sans, Caveat and JetBrains Mono are self-hosted from
the Wild & Native Gardens design system, all under the SIL Open Font License.
Subset to Latin woff2 by \`scripts/build-fonts.mjs\`.
`;
  writeFileSync(join(ROOT, 'CREDITS.md'), md);
}

if (DRY) {
  console.log(`  ✓ dry-run, sw.js and CREDITS.md not written\n`);
  process.exit(0);
}
writeCredits();
console.log(`  ✓ wrote CREDITS.md`);
if (changed) {
  writeFileSync(SW, next);
  console.log(`  ✓ wrote public/sw.js (cache osa-bingo-${VERSION}-${build})`);
} else {
  console.log(`  ✓ public/sw.js already current`);
}
// Ship the same bytes: dist/sw.js is what Cloudflare serves.
copyFileSync(SW, DIST_SW);
console.log(`  ✓ copied to dist/sw.js\n`);
