#!/usr/bin/env node
/* =============================================================
   moplants-check.mjs
   Validation gate for /moplants + CREDITS-moplants.md writer.
   NODE BUILT-INS ONLY.

   /moplants is deliberately NOT in the Osa service-worker
   precache (offline is not a requirement there, and sw.js
   bypasses /moplants entirely), so this is a separate check from
   build-manifest.mjs.

   Flags:
     --dry-run   validate only, do not write CREDITS-moplants.md
   ============================================================= */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'public', 'moplants');
const IMG = join(APP, 'img');
const DRY = process.argv.includes('--dry-run');
const EXPECTED = 25;
const REQUIRED = ['id', 'name', 'botanical', 'photo', 'fun_fact', 'sources', 'credit'];
const LICENSES = /^(public domain|cc0|cc by(-sa)? [\d.]+)/i;

const errors = [];
const err = m => errors.push(m);

let data;
try { data = JSON.parse(readFileSync(join(APP, 'species.json'), 'utf8')); }
catch (e) { console.error(`✗ Could not read public/moplants/species.json: ${e.message}`); process.exit(1); }
const species = Array.isArray(data.species) ? data.species : [];

let placeholders = new Set();
const ph = join(IMG, '.placeholders.json');
if (existsSync(ph)) { try { placeholders = new Set(JSON.parse(readFileSync(ph, 'utf8'))); } catch { /* ignore */ } }

if (species.length !== EXPECTED) err(`Expected exactly ${EXPECTED} plants, found ${species.length}.`);

const seen = new Set();
for (const s of species) {
  const label = s.id || s.name || '(unnamed)';
  for (const f of REQUIRED) if (s[f] === undefined || s[f] === null || s[f] === '') err(`[${label}] missing "${f}".`);
  if (!s.id) continue;
  if (seen.has(s.id)) err(`Duplicate id "${s.id}".`);
  seen.add(s.id);
  if (!/^[a-z0-9-]+$/.test(s.id)) err(`[${s.id}] id must be kebab-case.`);
  if (s.photo !== `img/${s.id}`) err(`[${s.id}] photo must be "img/${s.id}".`);
  for (const rel of ['webp', 'jpg'].flatMap(ext => [`${s.photo}.${ext}`, `img/thumb/${s.id}.${ext}`])) {
    if (!existsSync(join(APP, rel))) err(`[${s.id}] missing ${rel} (run npm run moplants:images).`);
  }
  if (!Array.isArray(s.sources) || !s.sources.every(x => x && x.label && /^https:\/\//.test(x.url))) {
    err(`[${s.id}] sources must be [{label, url}] with https URLs.`);
  }
  const c = s.credit || {};
  if (!placeholders.has(s.id)) {
    if (!c.author || !c.source || !c.license) err(`[${s.id}] real photo needs credit author, license and source.`);
    else if (!LICENSES.test(c.license)) err(`[${s.id}] license "${c.license}" is not PD, CC0, CC BY or CC BY-SA.`);
  }
}

const referenced = new Set(species.flatMap(s => [`${s.id}.webp`, `${s.id}.jpg`]));
for (const dir of ['img', 'img/thumb']) {
  const abs = join(APP, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs)) {
    if (/\.(webp|jpg)$/i.test(f) && !referenced.has(f)) err(`Orphan image in public/moplants/${dir}/: ${f}`);
  }
}

console.log(`\nMO plants · ${DRY ? 'check' : 'build'}`);
console.log(`  plants: ${species.length}  ·  placeholders: ${placeholders.size}  ·  flagged uncertain: ${species.filter(s => s.uncertain).length}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('  ✓ structure valid');
if (DRY) { console.log('  ✓ dry-run, CREDITS-moplants.md not written\n'); process.exit(0); }

// ---- CREDITS-moplants.md -----------------------------------
const cell = s => String(s).replace(/\|/g, '\\|');
const photoRows = species.map(s => {
  const c = s.credit || {};
  const credit = placeholders.has(s.id) ? '_placeholder, licensed photo pending_'
    : `${cell(c.author)}, ${cell(c.license)}, <${c.source}>`;
  return `| ${cell(s.name)} | ${credit} | ${cell(s.photo_note || 'Exact plant')} |`;
}).join('\n');
const factRows = species.map(s =>
  `| ${cell(s.name)} | ${s.sources.map(x => `[${cell(x.label)}](${x.url})`).join('<br>')} |`).join('\n');

writeFileSync(join(ROOT, 'CREDITS-moplants.md'), `# MO plants bingo: credits

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
`);
console.log('  ✓ wrote CREDITS-moplants.md\n');
