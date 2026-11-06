#!/usr/bin/env node
/* =============================================================
   build-og.mjs  (uses sharp)
   Local-only, like optimize-images.mjs: commit the output, nothing
   regenerates it in CI (CI installs with --ignore-scripts, so sharp
   is not available there). Run `npm run og` after changing a title
   or the photos below.

   Writes the 1200x630 share images the pages point at with og:image:
     public/og/osa.png       Osa wildlife bingo
     public/og/moplants.png  Plant bingo
     public/og/hub.png       Species bingo (both games' names)

   Each is a cream card with the title in forest green, a place line,
   and a mosaic of six of the game's own photos. Text is drawn by
   librsvg with the system serif and sans, so keep it short.
   ============================================================= */

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'og');

const W = 1200, H = 630;
const CREAM = '#f5efe3', FOREST = '#36492e', MOSS = '#6b7a52', SUN = '#e4a567';
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const osa = id => join(PUBLIC, 'osa', 'img', `${id}.webp`);
const plant = id => join(PUBLIC, 'moplants', 'img', `${id}.webp`);

const OSA_PHOTOS = [
  'scarlet-macaw', 'three-toed-sloth', 'red-eyed-tree-frog',
  'chestnut-mandibled-toucan', 'blue-morpho-butterfly', 'white-faced-capuchin',
].map(osa);
const PLANT_PHOTOS = [
  'cardinal-flower', 'lipstick-hosta', 'fireworks-goldenrod',
  'pink-lemonade', 'sweet-woodruff', 'elderberry',
].map(plant);

const CARDS = [
  {
    file: 'osa.png',
    lines: ['Osa wildlife', 'bingo'],
    place: 'Corcovado & Golfo Dulce, Costa Rica',
    note: 'Works offline',
    photos: OSA_PHOTOS,
  },
  {
    file: 'moplants.png',
    lines: ['Plant', 'bingo'],
    place: 'A garden list',
    note: 'Play with friends',
    photos: PLANT_PHOTOS,
  },
  {
    file: 'hub.png',
    lines: ['Species', 'bingo'],
    place: 'Osa wildlife bingo  ·  Plant bingo',
    note: 'Pick a game, share a card',
    photos: [OSA_PHOTOS[0], PLANT_PHOTOS[0], OSA_PHOTOS[1], PLANT_PHOTOS[1], OSA_PHOTOS[2], PLANT_PHOTOS[2]],
  },
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Mosaic: 2 columns x 3 rows of rounded tiles on the right.
const TILE_W = 250, TILE_H = 168, GAP = 14, RADIUS = 18;
const MOSAIC_X = W - 60 - (TILE_W * 2 + GAP);
const MOSAIC_Y = Math.round((H - (TILE_H * 3 + GAP * 2)) / 2);

async function tile(file) {
  if (!existsSync(file)) throw new Error(`missing photo ${file}`);
  const mask = Buffer.from(`<svg width="${TILE_W}" height="${TILE_H}"><rect width="${TILE_W}" height="${TILE_H}" rx="${RADIUS}" fill="#fff"/></svg>`);
  return sharp(file).resize(TILE_W, TILE_H, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

function textSvg(card) {
  // Long first lines get a smaller size so they stay inside the left column.
  const size = Math.max(...card.lines.map(l => l.length)) > 9 ? 76 : 112;
  const x = 70;
  const y1 = 250;
  const lines = card.lines.map((l, i) =>
    `<text x="${x}" y="${y1 + i * (size + 6)}" font-family="${SERIF}" font-size="${size}" font-weight="700" fill="${FOREST}">${esc(l)}</text>`).join('');
  const afterTitle = y1 + (card.lines.length - 1) * (size + 6);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="${x}" y="96" width="72" height="8" rx="4" fill="${SUN}"/>
  ${lines}
  <text x="${x}" y="${afterTitle + 64}" font-family="${SANS}" font-size="30" fill="${MOSS}">${esc(card.place)}</text>
  <text x="${x}" y="${H - 64}" font-family="${SANS}" font-size="26" font-weight="700" fill="${FOREST}" letter-spacing="1">${esc(card.note.toUpperCase())}</text>
</svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const card of CARDS) {
  const tiles = await Promise.all(card.photos.map(tile));
  const layers = [{ input: Buffer.from(textSvg(card)), left: 0, top: 0 }];
  tiles.forEach((input, i) => layers.push({
    input,
    left: MOSAIC_X + (i % 2) * (TILE_W + GAP),
    top: MOSAIC_Y + Math.floor(i / 2) * (TILE_H + GAP),
  }));
  const out = join(OUT, card.file);
  await sharp({ create: { width: W, height: H, channels: 3, background: CREAM } })
    .composite(layers).png({ compressionLevel: 9 }).toFile(out);
  console.log(`✓ ${out.slice(ROOT.length + 1)}`);
}
