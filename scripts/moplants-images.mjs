#!/usr/bin/env node
/* =============================================================
   moplants-images.mjs  (uses sharp)
   The /moplants twin of optimize-images.mjs. Local-only; commit
   the optimized output.

   - Reads raw downloads from img-raw/moplants/<id>.jpg (git-ignored)
   - Emits public/moplants/img/<id>.webp (q82, ~800px long edge) + .jpg
     for the detail sheet, and img/thumb/<id>.webp + .jpg (240x300,
     cropped to the subject) for the 5x5 grid, so a phone loads ~1/10
     of the bytes to draw the card
   - Skips already-processed, unchanged files (cheap reruns)
   - Any plant with no raw photo gets a clearly marked placeholder,
     recorded in public/moplants/img/.placeholders.json
   - Renders the /moplants home-screen icons
   ============================================================= */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'public', 'moplants');
const IMG = join(APP, 'img');
const ICONS = join(IMG, 'icons');
const THUMBS = join(IMG, 'thumb');
const RAW = join(ROOT, 'img-raw', 'moplants');

const LONG_EDGE = 800;
const THUMB_W = 240, THUMB_H = 300;   // matches the grid cell's 4:5 aspect
const WEBP_Q = 82;
const JPEG_Q = 82;
const RAW_EXT = ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG', 'WEBP'];

for (const d of [IMG, ICONS, THUMBS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

// Brand tokens (mirrored from tokens.css).
const C = {
  forest: '#36492e', forestDeep: '#1f2c1c', moss: '#6f7e3c', sage: '#b9c79c',
  terracotta: '#b86442', terracottaDeep: '#823f22', sun: '#e4a567', bloom: '#d98472',
  cream: '#f5efe3', paper: '#ebe3d2', ink: '#1f1d18',
};

const species = JSON.parse(readFileSync(join(APP, 'species.json'), 'utf8')).species;

function findRaw(id) {
  for (const ext of RAW_EXT) {
    const p = join(RAW, `${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
const outputs = id => ({
  webp: join(IMG, `${id}.webp`), jpg: join(IMG, `${id}.jpg`),
  tWebp: join(THUMBS, `${id}.webp`), tJpg: join(THUMBS, `${id}.jpg`),
});
function upToDate(srcPath, id) {
  const files = Object.values(outputs(id));
  if (!files.every(existsSync)) return false;
  const src = statSync(srcPath).mtimeMs;
  return files.every(f => statSync(f).mtimeMs >= src);
}
const bytes = id => Object.values(outputs(id)).reduce((n, f) => n + statSync(f).size, 0);

// Obvious stand-in, never mistakable for a photograph.
function placeholderSvg() {
  return Buffer.from(
`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${C.sage}"/>
  <rect x="26" y="26" width="748" height="748" rx="18" fill="none" stroke="rgba(31,29,24,0.5)" stroke-width="2"/>
  <g transform="translate(400 380)" stroke="rgba(31,29,24,0.72)" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 120 C-96 66 -96 -70 0 -124 C96 -70 96 66 0 120 Z"/>
    <path d="M0 120 L0 -124"/>
  </g>
  <text x="400" y="640" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="26" letter-spacing="10" fill="rgba(31,29,24,0.6)">PLACEHOLDER</text>
  <text x="400" y="684" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="rgba(31,29,24,0.6)">licensed photo pending</text>
</svg>`);
}

async function emit(imageBuf, id, isSvg) {
  const { webp, jpg, tWebp, tJpg } = outputs(id);
  const base = sharp(imageBuf).rotate().resize(LONG_EDGE, LONG_EDGE, {
    fit: isSvg ? 'fill' : 'inside', withoutEnlargement: !isSvg,
  });
  await base.clone().webp({ quality: WEBP_Q }).toFile(webp);
  await base.clone().jpeg({ quality: JPEG_Q, mozjpeg: true }).toFile(jpg);
  // 'attention' crops toward the most salient region (the flower, not the sky)
  const thumb = sharp(imageBuf).rotate().resize(THUMB_W, THUMB_H, { fit: 'cover', position: isSvg ? 'centre' : 'attention' });
  await thumb.clone().webp({ quality: WEBP_Q }).toFile(tWebp);
  await thumb.clone().jpeg({ quality: JPEG_Q, mozjpeg: true }).toFile(tJpg);
  return bytes(id);
}

// Icon: cream ground, five-petal bloom in terracotta with a sun center,
// so it reads differently from the forest-green Osa icon on a home screen.
function iconSvg(size, maskable) {
  const pad = maskable ? 0.28 : 0.14;
  const s = size, scale = s * (1 - pad * 2) / 512;
  const petals = [0, 72, 144, 216, 288].map(a =>
    `<ellipse cx="256" cy="150" rx="70" ry="104" fill="${C.terracotta}" transform="rotate(${a} 256 256)"/>`).join('');
  return Buffer.from(
`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${C.cream}"/>
  <g transform="translate(${s / 2} ${s / 2}) scale(${scale}) translate(-256 -256)">
    ${petals}
    <circle cx="256" cy="256" r="62" fill="${C.sun}" stroke="${C.terracottaDeep}" stroke-width="10"/>
  </g>
</svg>`);
}
async function makeIcon(name, size, maskable) {
  const p = join(ICONS, name);
  await sharp(iconSvg(size, maskable)).png().toFile(p);
  return statSync(p).size;
}

const kb = n => (n / 1024).toFixed(1) + ' KB';
async function run() {
  let real = 0, skipped = 0, outTotal = 0;
  const placeholders = [];
  for (const s of species) {
    const src = findRaw(s.id);
    if (src) {
      if (upToDate(src, s.id)) { skipped++; outTotal += bytes(s.id); continue; }
      outTotal += await emit(readFileSync(src), s.id, false);
      real++;
      console.log(`  photo   ${s.id}`);
    } else {
      placeholders.push(s.id);
      outTotal += await emit(placeholderSvg(), s.id, true);
    }
  }
  writeFileSync(join(IMG, '.placeholders.json'), JSON.stringify(placeholders) + '\n');

  let iconTotal = 0;
  iconTotal += await makeIcon('icon-192.png', 192, false);
  iconTotal += await makeIcon('icon-512.png', 512, false);
  iconTotal += await makeIcon('icon-maskable-512.png', 512, true);

  console.log(`\nMO plants images`);
  console.log(`  photos processed: ${real}   unchanged: ${skipped}   placeholders: ${placeholders.length}`);
  if (placeholders.length) console.log(`  placeholders: ${placeholders.join(', ')}`);
  console.log(`  photo payload (full + thumbs, webp + jpg, all ${species.length}): ${kb(outTotal)}   icons: ${kb(iconTotal)}\n`);
}
run().catch(e => { console.error(e); process.exit(1); });
