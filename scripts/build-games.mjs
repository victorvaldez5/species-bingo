#!/usr/bin/env node
/* =============================================================
   build-games.mjs
   One build pipeline for every game in games/games.json.
   NODE BUILT-INS ONLY (runs in CI, must stay cheap).

   For each game it:
     - validates the game's list file (count from game.json
       `list.expected`, required fields, photos on disk, credits),
     - writes the game's credits file (game.json `credits.file`),
     - stamps the game's service worker with a content-hash BUILD.
   Osa's worker (public/sw.js) also gets its precache list
   rewritten; Plant bingo's (public/moplants/sw.js) precaches
   nothing, only its cache name changes. Workers are then copied
   into dist/ so Cloudflare serves the same bytes.

   Exits non-zero on any structural failure. This is what stops you
   adding a species, forgetting its photo, and finding out while
   offline in a rainforest.

   Page HTML comes from the Astro build, so run `astro build`
   first (npm run build does). Everything else is read from public/.

   Flags:
     --dry-run   validate only, write nothing, needs no dist/
                 (npm run check)
   ============================================================= */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const DRY = process.argv.includes('--dry-run');

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const games = readJson(join(ROOT, 'games', 'games.json')).map(g => ({
  ...g,
  ...readJson(join(ROOT, 'games', g.id, 'game.json')),
}));

// A game's files live under public/<path>; Osa is at "/", so public/ itself.
const appDir = g => join(PUBLIC, g.path.replace(/^\/|\/$/g, ''));
const distDir = g => join(DIST, g.path.replace(/^\/|\/$/g, ''));
const placeholdersOf = dir => {
  const f = join(dir, 'img', '.placeholders.json');
  if (!existsSync(f)) return new Set();
  try { return new Set(JSON.parse(readFileSync(f, 'utf8'))); } catch { return new Set(); }
};

let failed = false;
const fail = (title, errors) => {
  failed = true;
  console.error(`\n✗ ${title}: ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
};

// ---- Per-game validation -----------------------------------
// The checks differ because the two lists carry different fields.

function validateOsa(g, species, placeholders, errors, warnings) {
  const REQUIRED = ['id', 'name', 'category', 'photo', 'id_note', 'fun_fact', 'credit'];
  const CATEGORIES = new Set(['mammal', 'bird', 'reptile', 'amphibian', 'invertebrate', 'plant', 'marine']);
  const dir = appDir(g);
  const seen = new Set();
  for (const s of species) {
    const label = s.id || s.name || '(unnamed)';
    for (const f of REQUIRED) {
      if (!(f in s) || s[f] === undefined || s[f] === null || s[f] === '') {
        errors.push(`[${label}] missing required field "${f}".`);
      }
    }
    if (!s.id) continue;
    if (seen.has(s.id)) errors.push(`Duplicate id "${s.id}".`);
    seen.add(s.id);

    if (!/^[a-z0-9-]+$/.test(s.id)) errors.push(`[${s.id}] id must be kebab-case (a-z, 0-9, hyphen).`);
    if (s.category && !CATEGORIES.has(s.category)) errors.push(`[${s.id}] unknown category "${s.category}".`);
    if (s.photo !== `img/${s.id}`) errors.push(`[${s.id}] photo stem "${s.photo}" must equal "img/${s.id}".`);

    // Both variants must exist on disk, or offline breaks for whichever the browser picks.
    for (const ext of ['webp', 'jpg']) {
      if (!existsSync(join(dir, `${s.photo}.${ext}`))) errors.push(`[${s.id}] photo missing on disk: ${s.photo}.${ext}`);
    }

    // Credit / license: a legal requirement once a real photo ships.
    const c = s.credit || {};
    const unsourced = c.status === 'unsourced' || (!c.author && !c.source);
    if (unsourced) {
      if (placeholders.has(s.id)) warnings.push(`[${s.id}] placeholder image, credit still pending.`);
      else errors.push(`[${s.id}] real photo present but credit/license is empty. CC-BY attribution is required to ship.`);
    }
  }
  orphans(species, dir, ['img'], errors);
}

function validateMoplants(g, species, placeholders, errors) {
  const REQUIRED = ['id', 'name', 'botanical', 'photo', 'fun_fact', 'sources', 'credit'];
  const LICENSES = /^(public domain|cc0|cc by(-sa)? [\d.]+)/i;
  const dir = appDir(g);
  const seen = new Set();
  for (const s of species) {
    const label = s.id || s.name || '(unnamed)';
    for (const f of REQUIRED) if (s[f] === undefined || s[f] === null || s[f] === '') errors.push(`[${label}] missing "${f}".`);
    if (!s.id) continue;
    if (seen.has(s.id)) errors.push(`Duplicate id "${s.id}".`);
    seen.add(s.id);
    if (!/^[a-z0-9-]+$/.test(s.id)) errors.push(`[${s.id}] id must be kebab-case.`);
    if (s.photo !== `img/${s.id}`) errors.push(`[${s.id}] photo must be "img/${s.id}".`);
    for (const rel of ['webp', 'jpg'].flatMap(ext => [`${s.photo}.${ext}`, `img/thumb/${s.id}.${ext}`])) {
      if (!existsSync(join(dir, rel))) errors.push(`[${s.id}] missing ${rel} (run npm run moplants:images).`);
    }
    if (!Array.isArray(s.sources) || !s.sources.every(x => x && x.label && String(x.url).startsWith('https://'))) {
      errors.push(`[${s.id}] sources must be [{label, url}] with https URLs.`);
    }
    const c = s.credit || {};
    if (!placeholders.has(s.id)) {
      if (!c.author || !c.source || !c.license) errors.push(`[${s.id}] real photo needs credit author, license and source.`);
      else if (!LICENSES.test(c.license)) errors.push(`[${s.id}] license "${c.license}" is not PD, CC0, CC BY or CC BY-SA.`);
    }
  }
  orphans(species, dir, ['img', 'img/thumb'], errors);
}

function orphans(species, dir, subdirs, errors) {
  const referenced = new Set(species.flatMap(s => [`${s.id}.webp`, `${s.id}.jpg`]));
  for (const sub of subdirs) {
    const abs = join(dir, sub);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {          // skips subdirs, .placeholders.json, icons
      if (/\.(webp|jpg)$/i.test(f) && !referenced.has(f)) {
        errors.push(`Orphan image in public${dir.slice(PUBLIC.length)}/${sub}/ that nothing references: ${f}`);
      }
    }
  }
}

const VALIDATORS = { osa: validateOsa, moplants: validateMoplants };

// ---- Credits files -----------------------------------------
// Content is committed and diffed by CI: change the text here and
// the generated files change with it.

function osaCredits(species, placeholders) {
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
  return `# Photo credits

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
}

function moplantsCredits(species, placeholders) {
  const cell = s => String(s).replace(/\|/g, '\\|');
  const photoRows = species.map(s => {
    const c = s.credit || {};
    const credit = placeholders.has(s.id) ? '_placeholder, licensed photo pending_'
      : `${cell(c.author)}, ${cell(c.license)}, <${c.source}>`;
    return `| ${cell(s.name)} | ${credit} | ${cell(s.photo_note || 'Exact plant')} |`;
  }).join('\n');
  const factRows = species.map(s =>
    `| ${cell(s.name)} | ${s.sources.map(x => `[${cell(x.label)}](${x.url})`).join('<br>')} |`).join('\n');
  return `# MO plants bingo: credits

Generated from \`public/moplants/species.json\` by \`scripts/moplants-check.mjs\`.
Edit the \`credit\` and \`sources\` blocks there, not here.

## Photos

All photos come from Wikimedia Commons under public domain, CC0, CC BY or
CC BY-SA licenses. CC BY and CC BY-SA require attribution, so each credit also
shows in the app's detail sheet and credits list.

| Plant | Photo credit | What the photo shows |
|---|---|---|
${photoRows}

## Fun facts

Paraphrased from these sources. Missouri Botanical Garden Plant Finder first,
university extension or the plant's introducer where it has no entry.

| Plant | Source |
|---|---|
${factRows}

## Fonts

Shared with the Osa app: Playfair Display, Nunito Sans, Caveat and JetBrains
Mono, all under the SIL Open Font License.
`;
}

const CREDITS = { osa: osaCredits, moplants: moplantsCredits };

// ---- Workers -----------------------------------------------
// Rewrite the BUILD line (and, for Osa, the precache block) of a worker file.
function stampWorker(file, build, precache) {
  const sw = readFileSync(file, 'utf8');
  let next = sw.replace(/const BUILD = '[^']*';/, `const BUILD = '${build}';`);
  if (precache) {
    if (!sw.includes('// BEGIN-PRECACHE') || !sw.includes('// END-PRECACHE')) {
      console.error(`✗ ${file} is missing the // BEGIN-PRECACHE / // END-PRECACHE markers.`);
      process.exit(1);
    }
    const block = precache.map(p => `  '${p}',`).join('\n');
    next = next.replace(/(\/\/ BEGIN-PRECACHE)[\s\S]*?(\s*\/\/ END-PRECACHE)/, `$1\n${block}\n  // END-PRECACHE`);
  }
  return { next, changed: next !== sw };
}

const hashFiles = (files, htmlFile) => {
  const hash = createHash('sha256');
  for (const { rel, path } of files) if (existsSync(path)) hash.update(rel).update(readFileSync(path));
  if (htmlFile) hash.update('html').update(readFileSync(htmlFile));
  return hash.digest('hex').slice(0, 10);
};

// ---- Run ---------------------------------------------------
console.log(`\nGames · ${DRY ? 'check' : 'build'}`);
const results = [];

for (const g of games) {
  const validate = VALIDATORS[g.id];
  if (!validate) { console.error(`✗ No validator for game "${g.id}" in scripts/build-games.mjs.`); process.exit(1); }
  const dir = appDir(g);
  const listPath = join(dir, g.list.file);
  let data;
  try { data = readJson(listPath); }
  catch (e) { console.error(`✗ Could not read/parse ${listPath.slice(ROOT.length + 1)}: ${e.message}`); process.exit(1); }
  const species = Array.isArray(data.species) ? data.species : [];
  const placeholders = placeholdersOf(dir);

  const errors = [];
  const warnings = [];
  if (species.length !== g.list.expected) {
    errors.push(`Expected exactly ${g.list.expected} ${g.list.noun}, found ${species.length}.`);
  }
  validate(g, species, placeholders, errors, warnings);

  console.log(`\n${g.name}`);
  console.log(`  ${g.list.noun}: ${species.length}  ·  placeholders: ${placeholders.size}  ·  real photos: ${species.length - placeholders.size}`);
  for (const w of warnings) console.log(`  ! ${w}`);
  if (errors.length) { fail(g.name, errors); continue; }
  console.log('  ✓ structure valid');
  results.push({ g, species, placeholders, dir });
}
if (failed) process.exit(1);

// ---- Build workers + write outputs -------------------------
const missingDist = games.filter(g => !existsSync(join(distDir(g), 'index.html')));
if (!DRY && missingDist.length) {
  console.error(`✗ dist/ pages not found (${missingDist.map(g => g.id).join(', ')}). Run \`npm run build\` (astro build first), not this script alone.`);
  process.exit(1);
}

const warn = [];
for (const { g, species, placeholders, dir } of results) {
  // Each game has its own worker file next to its page.
  const swFile = join(dir, g.worker);
  const htmlFile = join(distDir(g), 'index.html');
  const html = existsSync(htmlFile) ? htmlFile : null;
  let build, precache = null;

  if (g.offline) {
    // Osa: precache the shell, shared core, data, fonts, icons and every photo.
    const fontFiles = existsSync(join(PUBLIC, 'fonts'))
      ? readdirSync(join(PUBLIC, 'fonts')).filter(f => /\.(woff2|woff|ttf)$/i.test(f)).sort().map(f => `fonts/${f}`)
      : [];
    const iconFiles = ['img/icons/icon-192.png', 'img/icons/icon-512.png', 'img/icons/icon-maskable-512.png']
      .filter(p => existsSync(join(dir, p)));
    const photoFiles = species.flatMap(s => [`${s.photo}.webp`, `${s.photo}.jpg`]).sort();
    precache = [
      './', 'index.html',
      'core/deal.js', 'core/bingo.js', 'core/styles.css', 'tokens.css',
      g.list.file, 'manifest.webmanifest',
      ...fontFiles, ...iconFiles, ...photoFiles,
    ];
    if (fontFiles.length === 0) warn.push('no font files found in public/fonts — run `npm run fonts`.');
    if (iconFiles.length < 3) warn.push(`only ${iconFiles.length}/3 PWA icons present — run \`npm run images\`.`);
    // Fingerprint of every precached file's bytes (HTML from the Astro build),
    // so any asset change yields a new cache name and the update lands.
    const h = createHash('sha256');
    for (const rel of precache) {
      if (rel === './') continue;
      const p = rel === 'index.html' ? htmlFile : join(PUBLIC, rel);
      if (existsSync(p)) h.update(rel).update(readFileSync(p));
    }
    build = h.digest('hex').slice(0, 10);
  } else {
    // Plant bingo: no precache, so the hash covers what the page loads:
    // its page, data, manifest and the shared files.
    const shared = ['core/deal.js', 'core/bingo.js', 'core/styles.css', 'tokens.css'].map(rel => ({ rel, path: join(PUBLIC, rel) }));
    const own = [g.list.file, 'manifest.webmanifest'].map(rel => ({ rel: `${g.id}/${rel}`, path: join(dir, rel) }));
    build = hashFiles([...shared, ...own], html);
  }

  const { next, changed } = stampWorker(swFile, build, precache);
  const swRel = swFile.slice(ROOT.length + 1);
  console.log(`\n${g.name} worker`);
  if (precache) console.log(`  precache entries: ${precache.length}`);
  console.log(`  build hash: ${build}${changed ? '' : ' (unchanged)'}`);

  if (DRY) continue;
  if (g.credits?.file) {
    writeFileSync(join(ROOT, g.credits.file), CREDITS[g.id](species, placeholders));
    console.log(`  ✓ wrote ${g.credits.file}`);
  }
  if (changed) { writeFileSync(swFile, next); console.log(`  ✓ wrote ${swRel}`); }
  else console.log(`  ✓ ${swRel} already current`);
  // Ship the same bytes: dist/ is what Cloudflare serves.
  const out = join(distDir(g), g.worker);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(swFile, out);
  console.log(`  ✓ copied to ${out.slice(ROOT.length + 1)}`);
}
for (const w of warn) console.log(`  ! ${w}`);
console.log(DRY ? '\n  ✓ dry-run, nothing written\n' : '');
