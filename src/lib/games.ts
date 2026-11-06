// Build-time view of the games, for the hub, the credits page and the
// how-to page. Reads games/games.json, each game.json, and each game's list
// file straight from disk (Astro frontmatter runs in Node at build).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export interface Game { id: string; path: string; [key: string]: any }
export interface Loaded { game: Game; items: any[]; list: any }

// A game's list sits in the game's public folder, which follows its URL path
// (/osa/ -> public/osa/).
function listPath(game: Game): string {
  const file = join('public', game.path.replace(/^\/|\/$/g, ''), game.list.file);
  if (!existsSync(join(ROOT, file))) throw new Error(`list file for ${game.id} not found at ${file} (check its path in game.json)`);
  return file;
}

export function loadGames(): Loaded[] {
  return readJson('games/games.json').map((entry: { id: string }) => {
    const game: Game = readJson(`games/${entry.id}/game.json`);
    const list = readJson(listPath(game));
    return { game, items: list.species as any[], list };
  });
}

// The same "photo credit pending" rule public/core/bingo.js applies to a
// detail sheet: Osa needs an author or a source, Plant bingo an author.
export function creditPending(game: Game, item: any): boolean {
  const c = item.credit;
  if (!c) return true;
  return game.credits.pending === 'no-author'
    ? !c.author
    : c.status === 'unsourced' || (!c.author && !c.source);
}

// The grid photo of an item (no extension), rooted at the game's URL path.
export function photoStem(game: Game, item: any): string {
  const gp = game.gridPhoto;
  return game.path + (gp.variant === 'thumb' ? `${gp.dir}${item.id}` : item.photo);
}

// A hub-strip photo (no extension). `hub.stripDir` points the strip at small
// thumbs when the grid itself uses full photos (Osa precaches those for
// offline play; the thumbs are only for the hub, which caches at runtime).
export function stripStem(game: Game, item: any): string {
  return game.hub.stripDir ? `${game.path}${game.hub.stripDir}${item.id}` : photoStem(game, item);
}

// Win-pattern shapes as cell sets, for the small pictures. `line` shows the
// middle row as its example.
export function shapeCells(shape: string): Set<number> {
  switch (shape) {
    case 'line': return new Set([10, 11, 12, 13, 14]);
    case 'corners': return new Set([0, 4, 20, 24]);
    case 'x': return new Set([0, 4, 6, 8, 12, 16, 18, 20, 24]);
    default: return new Set(Array.from({ length: 25 }, (_, i) => i));
  }
}
