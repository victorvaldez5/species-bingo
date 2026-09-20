#!/usr/bin/env node
/* =============================================================
   build-fonts.mjs  (uses subset-font)
   The brand ships ~1.9MB of variable TTFs across 6 files, and every
   byte gets precached for offline. This cuts that down:

   - Converts TTF to woff2 (40-60% smaller for the same faces)
   - Subsets to a Latin superset (weight axes kept, so the variable
     range still works)
   - Drops faces this app does not use: JetBrains Mono italic is gone;
     JetBrains Mono ships roman only, for the seed string.

   Source TTFs live in fonts-src/ (git-ignored). Copy the five brand
   faces there, or point FONTS_SRC at the design system's fonts/ dir.
   Target: under 400KB total. The script prints the final figure.
   ============================================================= */

import subsetFont from 'subset-font';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'fonts');
const SRC = process.env.FONTS_SRC || join(ROOT, 'fonts-src');
const BUDGET_KB = 400;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// face: source TTF -> output woff2. Playfair keeps roman + italic;
// JetBrains Mono keeps roman only.
const FACES = [
  { src: 'PlayfairDisplay-VariableFont_wght.ttf',        out: 'PlayfairDisplay-roman.woff2' },
  { src: 'PlayfairDisplay-Italic-VariableFont_wght.ttf', out: 'PlayfairDisplay-italic.woff2' },
  { src: 'NunitoSans-VariableFont_YTLC_opsz_wdth_wght.ttf', out: 'NunitoSans.woff2' },
  { src: 'Caveat-VariableFont_wght.ttf',                 out: 'Caveat.woff2' },
  { src: 'JetBrainsMono-VariableFont_wght.ttf',          out: 'JetBrainsMono.woff2' },
];

// Latin superset: keep the app resilient to future copy edits without
// dragging in CJK/etc. Basic + Latin-1 + the brand's typographic marks.
function subsetText() {
  const cps = [];
  for (let c = 0x20; c <= 0x7e; c++) cps.push(c);          // printable ASCII
  for (let c = 0xa0; c <= 0xff; c++) cps.push(c);          // Latin-1 Supplement
  const extra = [0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026, 0x00b7,
                 0x2022, 0x2192, 0x2191, 0x2726];          // quotes, dashes, ellipsis, dot, bullet, arrows, star
  return String.fromCodePoint(...cps, ...extra);
}

const kb = n => (n / 1024).toFixed(1) + ' KB';

async function run() {
  const missing = FACES.filter(f => !existsSync(join(SRC, f.src)));
  if (missing.length) {
    console.error(`\n✗ Source TTFs not found in ${SRC}`);
    for (const m of missing) console.error(`  - ${m.src}`);
    console.error(`\nCopy the brand's variable TTFs into fonts-src/ (git-ignored),`);
    console.error(`or set FONTS_SRC to the design system's fonts/ directory, then rerun.\n`);
    process.exit(1);
  }

  const text = subsetText();
  let srcTotal = 0, outTotal = 0;
  console.log(`\nFonts  (subsetting to Latin, TTF → woff2)`);
  for (const face of FACES) {
    const srcPath = join(SRC, face.src);
    const buf = readFileSync(srcPath);
    const sub = await subsetFont(buf, text, { targetFormat: 'woff2' });
    writeFileSync(join(OUT, face.out), sub);
    srcTotal += statSync(srcPath).size;
    outTotal += sub.length;
    console.log(`  ${face.out.padEnd(28)} ${kb(buf.length).padStart(10)} → ${kb(sub.length).padStart(9)}`);
  }
  console.log(`  ${'—'.repeat(50)}`);
  console.log(`  source ${kb(srcTotal)}  →  shipped ${kb(outTotal)}  (${FACES.length} files)`);
  if (outTotal / 1024 > BUDGET_KB) {
    console.log(`  ! over the ${BUDGET_KB}KB target — consider instancing the variable axes.\n`);
  } else {
    console.log(`  ✓ under the ${BUDGET_KB}KB target.\n`);
  }
}
run().catch(e => { console.error(e); process.exit(1); });
