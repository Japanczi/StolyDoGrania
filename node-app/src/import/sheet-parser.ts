// TEMPORARY – the Google sign-up sheet import (see src/import/sheet-import-job.ts for why and how to remove it).
// Reads the "Zapisy" tab from Google's Visualization feed (JSON). Port of Data/Import/SheetParser.cs and
// SheetTableRow.cs. Columns are found by their header label, so moving them in the sheet doesn't matter;
// BGG links and covers are not imported.

import type { TableKind } from '../domain/play-table.ts';

/** One game row of the sign-up sheet ("Zapisy"), already cleaned up by parseSheet. */
export type SheetTableRow = {
  /** Trimmed, at most 200 characters. */
  title: string;
  kind: TableKind;
  /** "HH:MM", or null when the sheet has no hour yet. */
  start: string | null;
  maxPlayers: number;
  /** BGG weight as copied by the sheet, as text with up to 4 decimals (like games.weight); "0" when empty. */
  weight: string;
  /** How many seats within maxPlayers say "Zajęte". */
  takenSlots: number;
  /** Seat number (1-based) → player name, for seats with a name. */
  players: ReadonlyMap<number, string>;
};

export const maxTitleLength = 200;
export const maxNameLength = 100;

const freeSeat = 'WOLNE';
const takenSeat = 'ZAJĘTE';

/** The sheet couldn't be read, or doesn't look like the sign-up sheet. Nothing is synced then. */
export class SheetFormatError extends Error {
  override name = 'SheetFormatError';
}

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the feed's response body: `/*O_o*\/ google.visualization.Query.setResponse({...});`.
 * Throws SheetFormatError when the response isn't a readable sign-up sheet.
 */
export function parseSheet(response: string): SheetTableRow[] {
  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new SheetFormatError('The response holds no JSON.');
  }

  let root: unknown;
  try {
    root = JSON.parse(response.slice(start, end + 1));
  } catch (err) {
    throw new SheetFormatError('The response isn\'t valid sheet JSON.', { cause: err });
  }
  return parseRoot(root);
}

function parseRoot(root: unknown): SheetTableRow[] {
  if (!isObject(root) || root.status !== 'ok') {
    throw new SheetFormatError('The sheet feed reported an error (wrong tab name or a private sheet?).');
  }
  const table = root.table;
  if (!isObject(table) || !Array.isArray(table.cols) || !Array.isArray(table.rows)) {
    throw new SheetFormatError('The response isn\'t valid sheet JSON.');
  }

  const labels = table.cols.map(c => (isObject(c) && typeof c.label === 'string' ? c.label.trim() : ''));

  const title = findColumn(labels, 'Tytul', 'Tytuł');
  if (title === null) throw new SheetFormatError('No "Tytul" column.');
  const max = findColumn(labels, 'Max');
  if (max === null) throw new SheetFormatError('No "Max" column.');
  const kind = findColumn(labels, 'Stół', 'Stol');
  const hour = findColumn(labels, 'Start');
  const weight = findColumn(labels, 'Waga');

  // Slot columns by number: "Slot 1" → seat 1.
  const slots = new Map<number, number>();
  labels.forEach((label, index) => {
    const match = /^Slot\s*(\d+)$/i.exec(label);
    if (match?.[1] !== undefined) {
      const seat = Number(match[1]);
      if (slots.has(seat)) {
        throw new SheetFormatError(`Two "Slot ${seat}" columns.`);
      }
      slots.set(seat, index);
    }
  });
  if (!slots.has(1)) {
    throw new SheetFormatError('No "Slot 1" column.');
  }

  const rows: SheetTableRow[] = [];
  for (const row of table.rows) {
    if (!isObject(row) || !Array.isArray(row.c)) {
      throw new SheetFormatError('The response isn\'t valid sheet JSON.');
    }
    const cells: unknown[] = row.c;
    const rowTitle = truncate(text(cells, title), maxTitleLength);
    if (rowTitle.length === 0) {
      continue;
    }

    let maxPlayers = roundHalfEven(number(cells, max) ?? 0);
    if (maxPlayers < 1) {
      // No seat count yet: count up to the last filled seat, so nobody disappears.
      maxPlayers = Math.max(0, ...[...slots].filter(([, column]) => text(cells, column).length > 0).map(([seat]) => seat));
    }
    if (maxPlayers < 1) {
      continue;
    }

    const players = new Map<number, string>();
    let taken = 0;
    for (const [seat, column] of slots) {
      if (seat > maxPlayers) continue;
      const value = text(cells, column);
      if (value.length === 0 || value.toUpperCase() === freeSeat) {
        continue;
      }
      if (value.toUpperCase() === takenSeat) {
        taken++;
      } else {
        players.set(seat, truncate(value, maxNameLength));
      }
    }

    rows.push({
      title: rowTitle,
      kind: parseKind(kind === null ? '' : text(cells, kind)),
      start: hour === null ? null : parseHour(cell(cells, hour)),
      maxPlayers,
      weight: parseWeight(weight === null ? null : number(cells, weight)),
      takenSlots: taken,
      players,
    });
  }
  return rows;
}

export function parseKind(value: string): TableKind {
  switch (value.trim().toUpperCase()) {
    case '': case 'MAŁY': case 'MALY': return 'small';
    case 'DUŻY': case 'DUZY': return 'big';
    default: return 'other';
  }
}

/** Hours come as `Date(1899,11,30,18,0,0)`, with "18:00" as the formatted value. */
function parseHour(c: JsonObject | null): string | null {
  if (c === null) {
    return null;
  }
  const v = c.v;
  if (typeof v === 'string') {
    const m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+))?)?\)$/.exec(v);
    if (m?.[4] !== undefined && m[5] !== undefined) {
      return formatHour(Number(m[4]), Number(m[5]));
    }
  }
  const raw = 'f' in c ? c.f : v;
  const t = typeof raw === 'string' ? /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim()) : null;
  return t?.[1] !== undefined && t[2] !== undefined ? formatHour(Number(t[1]), Number(t[2])) : null;
}

function formatHour(hours: number, minutes: number): string | null {
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : null;
}

/** Stored with four decimals at most, like BGG's own weights; out-of-range values count as no rating. */
function parseWeight(value: number | null): string {
  return value !== null && value >= 0 && value < 10 ? String(Number(value.toFixed(4))) : '0';
}

function findColumn(labels: string[], ...names: string[]): number | null {
  const wanted = names.map(n => n.toUpperCase());
  const index = labels.findIndex(l => wanted.includes(l.toUpperCase()));
  return index < 0 ? null : index;
}

function cell(cells: unknown[], index: number): JsonObject | null {
  const c = cells[index];
  return isObject(c) ? c : null;
}

/** A cell's text with runs of whitespace collapsed to one space; numbers use their formatted value. */
function text(cells: unknown[], index: number): string {
  const c = cell(cells, index);
  if (c === null) {
    return '';
  }
  let value = '';
  if (typeof c.v === 'string') {
    value = c.v;
  } else if (typeof c.v === 'number') {
    value = typeof c.f === 'string' ? c.f : String(c.v);
  }
  return value.split(/\s+/).filter(s => s.length > 0).join(' ');
}

function number(cells: unknown[], index: number): number | null {
  const v = cell(cells, index)?.v;
  return typeof v === 'number' ? v : null;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length).trimEnd();
}

/** C#'s Math.Round: halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Keys that tie sheet rows to tables between imports: the title (case and spacing ignored) plus its occurrence
 * number, so two tables of the same game stay apart. Renaming a row in the sheet replaces its table.
 */
export function keysFor(rows: readonly SheetTableRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const title = normalizeTitle(row.title);
    const occurrence = (seen.get(title) ?? 0) + 1;
    seen.set(title, occurrence);
    return `${title}#${occurrence}`;
  });
}

export function normalizeTitle(title: string): string {
  return title.split(/\s+/).filter(s => s.length > 0).join(' ').toLowerCase();
}
