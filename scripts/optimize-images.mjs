#!/usr/bin/env node
/* =============================================================
   optimize-images.mjs  (uses sharp)
   Local-only. Commit the optimized output; nothing regenerates
   it on Cloudflare.

   - Reads raw downloads from img-raw/ (git-ignored, never deployed)
   - Emits public/osa/img/<id>.webp (q82, ~800px long edge) + .jpg fallback
   - Skips already-processed, unchanged files (cheap reruns)
   - For any species with no raw source yet, writes a clearly-marked
     BRANDED PLACEHOLDER so the app runs and precaches offline. Every
     placeholder id is recorded in public/osa/img/.placeholders.json so the
     validator can tell a placeholder from a real, credited photo.
   - Renders the PWA icons (192 / 512 / maskable)
   - Prints the before/after photo payload — the photos are the budget
   ============================================================= */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OSA = join(PUBLIC, 'osa');
const IMG = join(OSA, 'img');
const ICONS = join(IMG, 'icons');
const RAW = join(ROOT, 'img-raw');

const LONG_EDGE = 800;
const WEBP_Q = 82;
const JPEG_Q = 82;
const RAW_EXT = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'JPG', 'JPEG', 'PNG', 'WEBP'];

for (const d of [IMG, ICONS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

// Brand tokens (mirrored from tokens.css) for the placeholders/icons.
const C = {
  forest: '#36492e', forestDeep: '#1f2c1c', moss: '#6f7e3c', sage: '#b9c79c',
  sagePale: '#d8dfc1', terracotta: '#b86442', terracottaDeep: '#823f22',
  sun: '#e4a567', bloom: '#d98472', cream: '#f5efe3', paper: '#ebe3d2', ink: '#1f1d18',
};
const CAT_BG = {
  bird: C.sun, mammal: C.terracotta, reptile: C.moss, amphibian: C.forest,
  invertebrate: C.bloom, plant: C.sage, marine: C.forestDeep,
};
// foreground text kept legible on each category ground
const CAT_FG = {
  bird: C.ink, mammal: C.cream, reptile: C.cream, amphibian: C.cream,
  invertebrate: C.ink, plant: C.ink, marine: C.cream,
};

const species = JSON.parse(readFileSync(join(OSA, 'species.json'), 'utf8')).species;

function findRaw(id) {
  for (const ext of RAW_EXT) {
    const p = join(RAW, `${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
const outputs = id => ({ webp: join(IMG, `${id}.webp`), jpg: join(IMG, `${id}.jpg`) });
function upToDate(srcPath, id) {
  const { webp, jpg } = outputs(id);
  if (!existsSync(webp) || !existsSync(jpg)) return false;
  const src = statSync(srcPath).mtimeMs;
  return statSync(webp).mtimeMs >= src && statSync(jpg).mtimeMs >= src;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Branded placeholder: a category-colored plate with a leaf motif that
// reads as an obvious stand-in, never a real photograph. The species
// name is intentionally left off — the app already labels every cell,
// so printing it here would just double up in the grid.
function placeholderSvg(name, category) {
  const bg = CAT_BG[category] || C.paper;
  const fg = CAT_FG[category] || C.ink;
  const soft = fg === C.cream ? 'rgba(245,239,227,0.70)' : 'rgba(31,29,24,0.58)';
  const motif = fg === C.cream ? 'rgba(245,239,227,0.9)' : 'rgba(31,29,24,0.72)';
  return Buffer.from(
`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${bg}"/>
  <rect x="26" y="26" width="748" height="748" rx="18" fill="none" stroke="${soft}" stroke-width="2"/>
  <text x="400" y="150" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="24" letter-spacing="8" fill="${soft}">${escapeXml(category.toUpperCase())}</text>
  <g transform="translate(400 400)" stroke="${motif}" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 120 C-96 66 -96 -70 0 -124 C96 -70 96 66 0 120 Z"/>
    <path d="M0 120 L0 -124"/>
    <path d="M0 -30 L-58 -66 M0 20 L-58 -12 M0 -30 L58 -66 M0 20 L58 -12"/>
  </g>
  <text x="400" y="640" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="26" letter-spacing="10" fill="${soft}">PLACEHOLDER</text>
  <text x="400" y="684" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${soft}">licensed photo pending</text>
</svg>`);
}

async function emit(imageBuf, id, isSvg) {
  const { webp, jpg } = outputs(id);
  const base = sharp(imageBuf).resize(LONG_EDGE, LONG_EDGE, {
    fit: isSvg ? 'fill' : 'inside', withoutEnlargement: !isSvg,
  }).rotate(); // respect EXIF orientation for real photos
  await base.clone().webp({ quality: WEBP_Q }).toFile(webp);
  await base.clone().jpeg({ quality: JPEG_Q, mozjpeg: true }).toFile(jpg);
  return statSync(webp).size + statSync(jpg).size;
}

// ---- PWA icons ---------------------------------------------
function iconSvg(size, maskable) {
  // full-bleed forest ground; leaf sprig + sun dot centered.
  const pad = maskable ? 0.30 : 0.18;           // maskable keeps content in the safe zone
  const s = size, cx = s / 2, cy = s / 2;
  const scale = s * (1 - pad * 2) / 512;
  return Buffer.from(
`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${C.forest}"/>
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-256 -256)">
    <circle cx="352" cy="168" r="34" fill="${C.sun}"/>
    <path d="M256 400 C150 360 150 210 256 150 C362 210 362 360 256 400 Z" fill="none" stroke="${C.cream}" stroke-width="20" stroke-linejoin="round"/>
    <path d="M256 400 L256 150" stroke="${C.cream}" stroke-width="16" stroke-linecap="round"/>
    <path d="M256 250 L196 210 M256 300 L196 262 M256 250 L316 210 M256 300 L316 262" stroke="${C.sage}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="256" cy="424" r="16" fill="${C.terracotta}"/>
  </g>
</svg>`);
}
async function makeIcon(name, size, maskable) {
  const p = join(ICONS, name);
  await sharp(iconSvg(size, maskable)).png().toFile(p);
  return statSync(p).size;
}

// ---- Run ----------------------------------------------------
const kb = n => (n / 1024).toFixed(1) + ' KB';
async function run() {
  let realCount = 0, phCount = 0, skipped = 0, rawTotal = 0, outTotal = 0;
  const placeholders = [];

  for (const s of species) {
    const src = findRaw(s.id);
    if (src) {
      if (upToDate(src, s.id)) {
        skipped++;
        const { webp, jpg } = outputs(s.id);
        outTotal += statSync(webp).size + statSync(jpg).size;
        continue;
      }
      rawTotal += statSync(src).size;
      outTotal += await emit(readFileSync(src), s.id, false);
      realCount++;
      process.stdout.write(`  photo   ${s.id}\n`);
    } else {
      placeholders.push(s.id);
      const { webp, jpg } = outputs(s.id);
      if (existsSync(webp) && existsSync(jpg)) { skipped++; outTotal += statSync(webp).size + statSync(jpg).size; continue; }
      outTotal += await emit(placeholderSvg(s.name, s.category), s.id, true);
      phCount++;
    }
  }

  writeFileSync(join(IMG, '.placeholders.json'), JSON.stringify(placeholders, null, 0) + '\n');

  // icons
  let iconTotal = 0;
  iconTotal += await makeIcon('icon-192.png', 192, false);
  iconTotal += await makeIcon('icon-512.png', 512, false);
  iconTotal += await makeIcon('icon-maskable-512.png', 512, true);

  console.log(`\nImages`);
  console.log(`  real photos processed: ${realCount}   placeholders made: ${phCount}   unchanged: ${skipped}`);
  console.log(`  placeholders remaining: ${placeholders.length}/${species.length}  (need real, licensed photos)`);
  if (rawTotal) console.log(`  raw in:  ${kb(rawTotal)}`);
  console.log(`  photo payload out (webp + jpg, all ${species.length}): ${kb(outTotal)}`);
  console.log(`  icons: ${kb(iconTotal)}`);
  console.log(`  total shipped image bytes: ${kb(outTotal + iconTotal)}\n`);
  if (placeholders.length) {
    console.log(`  Next: drop a licensed photo named <id>.jpg (or .png/.webp) into img-raw/`);
    console.log(`  and rerun. Fill that species' credit block before it ships.\n`);
  }
}
run().catch(e => { console.error(e); process.exit(1); });
