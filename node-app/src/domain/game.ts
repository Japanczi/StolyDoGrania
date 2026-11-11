// Catalog game rules and display helpers. Port of the rules in Data/Table/Game.cs and of
// Components/Pages/GameDisplay.cs.

import type { TableKind } from './play-table.ts';

export const maxCoverBytes = 2 * 1024 * 1024;
export const allowedCoverTypes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const defaultBggUrl = 'https://boardgamegeek.com/';

/** Games with a higher player count can't get a table (Tables:MaximumSpotsAllowed in the .NET app). */
export const maximumSpotsAllowed = 20;

export function tooManySpotsError(maxPlayers: number): string | null {
  return maxPlayers > maximumSpotsAllowed
    ? `Nie można tworzyć stołów dla gier z więcej niż ${maximumSpotsAllowed} miejscami.`
    : null;
}

/** A generated placeholder (the .NET seed's SVG) doesn't count as a cover. */
export function isMissingCover(coverType: string | null): boolean {
  return coverType === null || coverType === 'image/svg+xml';
}

/** Users can only provide a cover for a game that BGG doesn't have, and only once. */
export function canUploadCover(game: { bggId: number | null; coverType: string | null }): boolean {
  return game.bggId === null && isMissingCover(game.coverType);
}

/**
 * The real type of an image from its first bytes ("magic numbers"), or null if it isn't one we accept.
 * The browser's declared type can't be trusted, so uploads are checked by content too.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

// ---------- display (GameDisplay.cs) ----------

export function kindLabel(kind: TableKind): string {
  return kind === 'small' ? 'Mały' : kind === 'big' ? 'Duży' : 'Inny';
}

export function kindClass(kind: TableKind): string {
  return `kind-${kind}`;
}

/** BGG weight as stored (text, exactly as BGG gave it); "0" = not rated. Shown with up to 4 decimals, "–" if unrated. */
export function difficultyLabel(weight: string): string {
  const value = Number(weight);
  if (!(value > 0)) {
    return '–';
  }
  // The .NET app stored 4 decimal places and printed "0.####": round to 4, drop trailing zeros, keep the dot.
  return String(Number(value.toFixed(4)));
}

/** Heat scale over 0–5: green (easy) through yellow and orange to red (hard). */
export function difficultyStyle(weight: string): string | null {
  const value = Number(weight);
  return value > 0 ? `background-color:hsl(${Math.trunc(120 - value * 24)}, 85%, 68%);color:#222;` : null;
}

/** Derived from the name, so a game keeps its colour across restarts. Same formula as C# (sum of UTF-16 codes). */
export function placeholderHue(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  return (sum * 47) % 360;
}

/** "Name (year)" unless the name already ends with the year (catalog names of editions do). */
export function catalogLabel(name: string, year: number | null): string {
  return year !== null && !name.includes(`(${year})`) ? `${name} (${year})` : name;
}

/**
 * Catalog names are unique, but BGG lists separate editions under the same name: try the name, then
 * "Name (year)", then "Name [BGG id]". `isTaken` says whether a name is used by another catalog game.
 */
export function uniqueCatalogName(name: string, year: number | null, bggId: number, isTaken: (candidate: string) => boolean): string {
  const options = year !== null ? [name, `${name} (${year})`] : [name];
  return options.find(option => !isTaken(option)) ?? `${name} [BGG ${bggId}]`;
}
