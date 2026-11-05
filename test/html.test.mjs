/* The Astro build must emit the same two pages the site had before Astro.
   Fixtures in test/fixtures/html/ are the hand-written files from commit
   3e631f4. We compare the built dist/ pages to them after normalising only
   whitespace (runs collapse to one space, none between tags), the case of
   the doctype, and a <meta name="generator"> tag if Astro ever adds one.
   Elements, attributes, ids, classes, text and URLs must match exactly.
   Needs `npm run build` first; skips with a message when dist/ is missing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const path = p => fileURLToPath(new URL(p, ROOT));

const norm = html => html
  .replace(/<meta name="generator"[^>]*>/gi, '')
  .replace(/^\s*<!doctype html>/i, '<!doctype html>')
  .replace(/\s+/g, ' ')
  .replace(/>\s+</g, '><')
  .trim();

const pages = [
  ['dist/index.html', 'test/fixtures/html/index.html'],
  ['dist/moplants/index.html', 'test/fixtures/html/moplants.html'],
];

for (const [built, fixture] of pages) {
  test(`${built} matches the pre-Astro page`, t => {
    if (!existsSync(path(built))) {
      t.skip(`${built} not found; run \`npm run build\` first`);
      return;
    }
    const a = norm(readFileSync(path(built), 'utf8'));
    const b = norm(readFileSync(path(fixture), 'utf8'));
    if (a !== b) {
      let i = 0;
      while (a[i] === b[i]) i++;
      assert.fail(`differs at char ${i}\n built:   ...${a.slice(Math.max(0, i - 60), i + 80)}\n fixture: ...${b.slice(Math.max(0, i - 60), i + 80)}`);
    }
  });
}
