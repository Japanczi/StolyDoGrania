// TEMPORARY – the Google sign-up sheet import (see sheet-import-job.ts).
// The JSON feed that parseSheet reads only gives a link cell's text ("Link"), not its URL. The sheet's public HTML
// view (…/htmlview/sheet?headers=true&gid=0) has the real links, wrapped by Google as
// "https://www.google.com/url?q=https://boardgamegeek.com/boardgame/<id>&…". This reads them per game title.
// It's scraping a page meant for people, so anything unexpected yields fewer links, never an error: the import then
// falls back to searching BGG by name.

import { maxTitleLength, normalizeTitle } from './sheet-parser.ts';

const bggIdPattern = /boardgamegeek\.com(?:\/|%2F)boardgame(?:expansion)?(?:\/|%2F)(\d+)/i;
const titleLabels = ['TYTUL', 'TYTUŁ'];

/** Normalized game title (as normalizeTitle gives it) → BGG id, from the first row of that title with a BGG link. */
export function parseSheetLinks(html: string): Map<string, number> {
  const links = new Map<string, number>();
  let titleColumn: number | null = null;

  for (const part of html.split(/<tr\b/i).slice(1)) {
    const end = part.search(/<\/tr>/i);
    const rowHtml = end < 0 ? part : part.slice(0, end);
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cellText(m[1] ?? ''));

    // Rows above the sheet's own header row (Google's column letters) are skipped until "Tytul" is found.
    if (titleColumn === null) {
      const index = cells.findIndex(c => titleLabels.includes(c.toUpperCase()));
      if (index >= 0) titleColumn = index;
      continue;
    }

    const title = normalizeTitle((cells[titleColumn] ?? '').slice(0, maxTitleLength));
    const id = Number(bggIdPattern.exec(rowHtml)?.[1]);
    if (title !== '' && Number.isSafeInteger(id) && id > 0 && !links.has(title)) {
      links.set(title, id);
    }
  }
  return links;
}

/** A cell's visible text: tags removed, the usual HTML entities decoded, whitespace collapsed. */
function cellText(cellHtml: string): string {
  return cellHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const e = entity.toLowerCase();
      if (e.startsWith('#')) {
        const code = e.startsWith('#x') ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        // fromCodePoint throws outside Unicode's range.
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[e] ?? '';
    })
    .split(/\s+/).filter(s => s.length > 0).join(' ');
}
