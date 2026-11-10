// Game lookup for the new-table row and the rename popup: the catalog's titles first, then BGG.
// Port of OnGameNameChangedAsync / SearchBggAsync / ImportFromBggAsync / SelectCatalogGameAsync in Tables.razor.
//
// In Blazor the lookup state lived in the circuit; here each step is one stateless request and board.js keeps the
// state in the page. The server returns plain data (JSON); the browser shows it with textContent (no HTML from
// the server is inserted, so nothing in a game name can inject markup).

import type { Db } from '../../../db/database.ts';
import {
  findBggGamesByAnyName, findGameByBggId, findHandAddedGame, saveBggGame, type CatalogGame,
} from '../../../db/queries/games.ts';
import { catalogLabel, difficultyLabel, difficultyStyle } from '../../../domain/game.ts';
import type { TableKind } from '../../../domain/play-table.ts';
import { BggUnavailableError, type BggClient } from '../../../integrations/bgg/client.ts';

const maxListedCandidates = 20;

/** A catalog game as the page needs it. */
export type GameView = {
  id: number;
  name: string;
  label: string;
  kind: TableKind;
  maxPlayers: number;
  bggId: number | null;
  bggUrl: string | null;
  difficultyLabel: string;
  difficultyStyle: string | null;
  coverUrl: string | null;
};

export type Candidate = { name: string; year: number | null; bggId: number };

export type LookupResult =
  /** One game chosen. `note` e.g. "Znaleziono na BoardGameGeek: …" */
  | { kind: 'selected'; game: GameView; note: string | null }
  /** Several possibilities: the user picks one (or "Żadna z tych"). */
  | { kind: 'candidates'; title: string; candidates: Candidate[] }
  /** Nothing chosen: a new hand-added game will be created, or this existing hand-added one used. */
  | { kind: 'none'; note: string | null; game: GameView | null };

export function gameView(g: CatalogGame): GameView {
  return {
    id: g.id,
    name: g.name,
    label: catalogLabel(g.name, g.year),
    kind: g.kind,
    maxPlayers: g.maxPlayers,
    bggId: g.bggId,
    bggUrl: g.bggId !== null ? `https://boardgamegeek.com/boardgame/${g.bggId}` : null,
    difficultyLabel: difficultyLabel(g.weight),
    difficultyStyle: difficultyStyle(g.weight),
    coverUrl: g.hasCover ? `/covers/${g.id}` : null,
  };
}

const unavailableNote = 'Nie udało się połączyć z BoardGameGeek. Spróbuj ponownie przyciskiem BGG albo dodaj grę ręcznie.';

export type LookupDeps = { db: Db; bgg: BggClient };

/**
 * mode 'auto': the name field lost focus – catalog first (BGG games by any title), then BGG.
 * mode 'bgg': the BGG button – always ask BGG, never pick automatically (e.g. to choose another edition).
 * mode 'hand': "Żadna z tych" – use an existing hand-added game of this name, if any.
 */
export async function lookupGame(deps: LookupDeps, name: string, mode: 'auto' | 'bgg' | 'hand', kind: TableKind): Promise<LookupResult> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { kind: 'none', note: null, game: null };
  }
  if (mode === 'hand') {
    return handAdded(deps, trimmed, 'Gra zostanie dodana ręcznie.');
  }
  if (mode === 'bgg') {
    return withBgg(deps, trimmed, () => searchBgg(deps, trimmed, false, kind));
  }

  // Hand-added games aren't considered yet: they're only used when BGG has nothing.
  const matches = await findBggGamesByAnyName(deps.db, trimmed);
  const [only] = matches;
  if (matches.length === 1 && only) {
    // Its cover couldn't be downloaded last time: try again.
    if (!only.hasCover && only.bggId !== null) {
      const bggId = only.bggId;
      return withBgg(deps, trimmed, () => importFromBgg(deps, bggId, kind), only);
    }
    return selected(only);
  }
  if (matches.length > 1) {
    return {
      kind: 'candidates',
      title: 'Ta nazwa pasuje do kilku gier w katalogu. Wybierz właściwą:',
      candidates: matches.map(g => ({ name: g.name, year: g.year, bggId: g.bggId ?? 0 })),
    };
  }
  return withBgg(deps, trimmed, () => searchBgg(deps, trimmed, true, kind));
}

/** A candidate was picked: import it from BGG (or take it from the catalog if already there with a cover). */
export async function pickBggGame(deps: LookupDeps, bggId: number, kind: TableKind): Promise<LookupResult> {
  return withBgg(deps, '', () => importFromBgg(deps, bggId, kind));
}

/** Runs a BGG step; without a token, or when BGG can't be reached, falls back to a hand-added game. */
async function withBgg(deps: LookupDeps, name: string, step: () => Promise<LookupResult>, fallback?: CatalogGame): Promise<LookupResult> {
  if (!deps.bgg.isConfigured) {
    return fallback ? selected(fallback) : handAdded(deps, name, null);
  }
  try {
    return await step();
  } catch (err) {
    if (err instanceof BggUnavailableError) {
      return fallback ? { ...selected(fallback), note: unavailableNote } : handAdded(deps, name, unavailableNote);
    }
    throw err;
  }
}

async function searchBgg(deps: LookupDeps, name: string, pickSingleExactMatch: boolean, kind: TableKind): Promise<LookupResult> {
  const results = await deps.bgg.search(name);
  const lower = name.toLowerCase();
  const exact = results.filter(r => r.name.toLowerCase() === lower);
  const [firstExact] = exact;
  const [firstResult] = results;

  if (results.length === 0) {
    return handAdded(deps, name, 'Nie znaleziono tej gry na BoardGameGeek. Możesz dodać ją ręcznie.');
  }
  if (pickSingleExactMatch && (exact.length === 1 || results.length === 1)) {
    const pick = exact.length === 1 ? firstExact : firstResult;
    if (pick) {
      return importFromBgg(deps, pick.id, kind);
    }
  }
  const title = results.length > maxListedCandidates
    ? `Znaleziono ${results.length} gier na BoardGameGeek, poniżej pierwsze ${maxListedCandidates}. Wybierz właściwą lub zawęź nazwę:`
    : 'Wybierz właściwą grę lub wydanie z BoardGameGeek:';
  // Exact title matches first, newest editions first within each group.
  const sorted = results.toSorted((a, b) => {
    const exactDiff = Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower);
    return exactDiff !== 0 ? exactDiff : (b.year ?? -Infinity) - (a.year ?? -Infinity);
  });
  return {
    kind: 'candidates',
    title,
    candidates: sorted.slice(0, maxListedCandidates).map(r => ({ name: r.name, year: r.year, bggId: r.id })),
  };
}

/** Adds a BGG game to the catalog (once), cover included, and selects it. */
async function importFromBgg(deps: LookupDeps, bggId: number, kind: TableKind): Promise<LookupResult> {
  const cached = await findGameByBggId(deps.db, bggId);
  if (cached?.hasCover) {
    return selected(cached);
  }
  const details = await deps.bgg.getGame(bggId);
  if (!details) {
    return { kind: 'none', note: 'BoardGameGeek nie zwrócił danych tej gry.', game: null };
  }
  const cover = details.thumbnailUrl ? await deps.bgg.downloadCover(details.thumbnailUrl) : null;
  await saveBggGame(deps.db, details, cover, kind);
  const imported = await findGameByBggId(deps.db, bggId);
  return imported ? selected(imported) : { kind: 'none', note: 'Nie udało się zapisać gry w katalogu. Spróbuj ponownie.', game: null };
}

function selected(game: CatalogGame): Extract<LookupResult, { kind: 'selected' }> {
  const view = gameView(game);
  return { kind: 'selected', game: view, note: game.bggId !== null ? `Znaleziono na BoardGameGeek: ${view.label}` : null };
}

async function handAdded(deps: LookupDeps, name: string, note: string | null): Promise<LookupResult> {
  const game = name === '' ? null : await findHandAddedGame(deps.db, name);
  return { kind: 'none', note, game: game ? gameView(game) : null };
}
