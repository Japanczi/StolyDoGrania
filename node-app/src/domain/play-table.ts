// Business rules of one table on the board. Port of Data/Table/PlayTable.cs (and TableSlot.cs).
//
// Plain data + functions: a PlayTable is a plain object (loaded from the database by db/queries/board.ts),
// and each rule is a function that checks it and, if allowed, changes it in memory. The caller then saves
// the whole table in one transaction. C#'s `bool TryX(..., out string? error)` becomes a returned Result.
// Polish error texts are unchanged from the C# code.
// ApplyImport lives with the (temporary) sheet import in src/import/apply-import.ts, so it can be removed in one go.

export type TableKind = 'small' | 'big' | 'other';

export const tableKinds: readonly TableKind[] = ['small', 'big', 'other'];

/** The owner always sits here; taking this slot when it is vacant makes that user the owner. */
export const ownerSlot = 1;

export type TableSlot = {
  /** 1..maxPlayers */
  slotNumber: number;
  /** The name shown on the seat. */
  participantName: string;
  /** The registered user in this seat; null for a name typed by the owner, or a deleted account. */
  userId: string | null;
  /**
   * TEMPORARY (sheet import, src/import/): true for a seat copied from the sign-up sheet, which the import owns and
   * may change or remove. Absent/false for seats taken in the app.
   */
  isImported?: boolean;
};

export type PlayTable = {
  id: number;
  gameId: number;
  /** The title as typed when creating the table; null for tables created before this was stored. */
  gameTitle: string | null;
  /** Meeting hour "HH:MM" (quarter-hour steps), or null when not set yet. */
  startHour: string | null;
  maxPlayers: number;
  kind: TableKind;
  /** Null for tables without an owner (created before this was tracked, or the owner's account was deleted). */
  ownerUserId: string | null;
  /** Seats marked "Zajęte" by the owner: the highest-numbered markable seats. Change with trySetTakenSlots. */
  takenSlots: number;
  participants: TableSlot[];
};

export type Failure = { ok: false; error: string };
export type Result = { ok: true } | Failure;

const ok: Result = { ok: true };
const fail = (error: string): Failure => ({ ok: false, error });

/** The name to show for the table's game: the typed title, else the catalog name. */
export function displayTitle(table: PlayTable, gameName: string): string {
  return table.gameTitle ?? gameName;
}

export function isOwner(table: PlayTable, userId: string | null): boolean {
  return userId !== null && table.ownerUserId === userId;
}

/** Unoccupied seats that may be marked as taken; a table's owner seat is never one of them. */
function markableSlots(table: PlayTable): number[] {
  const seats: number[] = [];
  for (let n = 1; n <= table.maxPlayers; n++) {
    const occupied = table.participants.some(p => p.slotNumber === n);
    if (!occupied && (table.ownerUserId === null || n !== ownerSlot)) {
      seats.push(n);
    }
  }
  return seats;
}

/** The largest allowed value of takenSlots. */
export function maxTakenSlots(table: PlayTable): number {
  return markableSlots(table).length;
}

/** Marks fill the highest-numbered markable seats, passing over seated players. */
export function isSlotTaken(table: PlayTable, slot: number): boolean {
  return markableSlots(table).toSorted((a, b) => b - a).slice(0, table.takenSlots).includes(slot);
}

export function availableSlots(table: PlayTable): number {
  return Math.max(0, table.maxPlayers - table.takenSlots);
}

export function freeSlots(table: PlayTable): number {
  return Math.max(0, availableSlots(table) - table.participants.length);
}

export function isFull(table: PlayTable): boolean {
  return freeSlots(table) === 0;
}

export type NewTable = {
  gameId: number;
  gameTitle: string;
  kind: TableKind;
  maxPlayers: number;
  takenSlots: number;
  startHour: string | null;
  ownerUserId: string;
  ownerName: string;
};

/**
 * Creates a new table owned by `ownerUserId`, who is seated in the owner slot. The spots limit from settings
 * is checked by the caller. The id is 0 until the database assigns one.
 */
export function tryCreate(input: NewTable): { ok: true; table: PlayTable } | Failure {
  if (input.maxPlayers < 1) {
    return fail('Stół musi mieć co najmniej jedno miejsce.');
  }
  if (input.takenSlots < 0 || input.takenSlots >= input.maxPlayers) {
    return fail('Przy stole musi zostać co najmniej jedno miejsce dla Ciebie.');
  }
  const table: PlayTable = {
    id: 0,
    gameId: input.gameId,
    gameTitle: input.gameTitle,
    startHour: input.startHour,
    maxPlayers: input.maxPlayers,
    kind: input.kind,
    ownerUserId: input.ownerUserId,
    takenSlots: input.takenSlots,
    participants: [],
  };
  const seated = tryTakeSlot(table, ownerSlot, input.ownerName, input.ownerUserId);
  return seated.ok ? { ok: true, table } : seated;
}

/**
 * Seats a logged-in user on a chosen slot; each user may hold one seat per table.
 * Taking the owner slot makes the user the owner, so a vacated seat hands the table over.
 * Tables without an owner stay without one.
 */
export function tryTakeSlot(table: PlayTable, slot: number, participantName: string, userId: string): Result {
  if (slot < 1 || slot > table.maxPlayers || isSlotTaken(table, slot)) {
    return fail('Nie można zająć tego miejsca.');
  }
  if (table.participants.some(p => p.slotNumber === slot)) {
    return fail('To miejsce zostało właśnie zajęte przez kogoś innego.');
  }
  if (table.participants.some(p => p.userId === userId)) {
    return fail('Masz już miejsce przy tym stole.');
  }
  if (isOwner(table, userId) && slot !== ownerSlot) {
    return fail('Jako właściciel stołu możesz zająć tylko pierwsze miejsce.');
  }
  if (slot === ownerSlot && table.ownerUserId !== null) {
    table.ownerUserId = userId;
  }
  table.participants.push({ slotNumber: slot, participantName: participantName.trim(), userId });
  return ok;
}

export function trySetTakenSlots(table: PlayTable, count: number): Result {
  const max = maxTakenSlots(table);
  if (!Number.isInteger(count) || count < 0 || count > max) {
    return fail(`Liczba zajętych miejsc musi mieścić się w zakresie 0–${max}.`);
  }
  table.takenSlots = count;
  return ok;
}

/**
 * Owner's action: seats someone else, either a registered user or a free-text name (null user id).
 * Using a slot marked as taken lowers the counter by one; the other marks stay where they are.
 */
export function tryAddPlayer(table: PlayTable, slot: number, participantName: string, playerUserId: string | null): Result {
  const name = participantName.trim();
  if (name.length === 0 || name.length > 100) {
    return fail('Nazwa gracza musi mieć od 1 do 100 znaków.');
  }
  if (slot === ownerSlot) {
    return fail('Pierwsze miejsce jest zarezerwowane dla właściciela stołu.');
  }
  if (slot < 1 || slot > table.maxPlayers) {
    return fail('Nie można zająć tego miejsca.');
  }
  if (playerUserId !== null && (isOwner(table, playerUserId) || table.participants.some(p => p.userId === playerUserId))) {
    return fail('Ten gracz ma już miejsce przy tym stole.');
  }
  if (table.participants.some(p => p.slotNumber === slot)) {
    return fail('To miejsce zostało właśnie zajęte przez kogoś innego.');
  }
  if (isSlotTaken(table, slot)) {
    table.takenSlots--;
  }
  table.participants.push({ slotNumber: slot, participantName: name, userId: playerUserId });
  return ok;
}

/**
 * Admin's action: seats a registered user in the owner slot and makes them the owner.
 * Whoever sat there leaves the table; a new owner seated elsewhere moves over, keeping one seat per user.
 */
export function tryAssignOwner(table: PlayTable, newOwnerUserId: string, participantName: string): Result {
  const name = participantName.trim();
  if (name.length === 0 || name.length > 100) {
    return fail('Nazwa gracza musi mieć od 1 do 100 znaków.');
  }
  if (isSlotTaken(table, ownerSlot)) {
    return fail('Pierwsze miejsce jest oznaczone jako zajęte.');
  }
  table.participants = table.participants.filter(p => !(p.userId === newOwnerUserId && p.slotNumber !== ownerSlot));
  const ownerSeat = table.participants.find(p => p.slotNumber === ownerSlot);
  if (ownerSeat) {
    ownerSeat.participantName = name;
    ownerSeat.userId = newOwnerUserId;
  } else {
    table.participants.push({ slotNumber: ownerSlot, participantName: name, userId: newOwnerUserId });
  }
  table.ownerUserId = newOwnerUserId;
  return ok;
}

/**
 * Owner's action: switches the table to another game (or just retitles it), with that game's seat count.
 * Starts the sign-up over: every player leaves and the marks are cleared; a seated owner keeps the first seat.
 */
export function tryChangeGame(table: PlayTable, gameId: number, title: string, maxPlayers: number): Result {
  const name = title.trim();
  if (name.length === 0 || name.length > 200) {
    return fail('Nazwa gry musi mieć od 1 do 200 znaków.');
  }
  if (maxPlayers < 1) {
    return fail('Gra musi mieć co najmniej jedno miejsce.');
  }
  table.participants = table.participants.filter(p => p.slotNumber === ownerSlot && isOwner(table, p.userId));
  table.gameId = gameId;
  table.gameTitle = name;
  table.maxPlayers = maxPlayers;
  table.takenSlots = 0;
  return ok;
}

/** Frees a seat (who may do it is decided by the query: see removableBy in db/queries/board.ts). */
export function leave(table: PlayTable, slot: number): boolean {
  const before = table.participants.length;
  table.participants = table.participants.filter(p => p.slotNumber !== slot);
  return table.participants.length < before;
}

/** Seats a name in the first free, unmarked seat; returns the seat number, or null when the table is full. */
export function join(table: PlayTable, participantName: string): number | null {
  if (participantName.trim() === '') {
    throw new Error('Nazwa uczestnika nie może być pusta.');
  }
  for (let slot = 1; slot <= table.maxPlayers; slot++) {
    if (!isSlotTaken(table, slot) && table.participants.every(p => p.slotNumber !== slot)) {
      table.participants.push({ slotNumber: slot, participantName: participantName.trim(), userId: null });
      return slot;
    }
  }
  return null;
}

// ---------- hours ----------

/** The 96 quarter-hour options "00:00" … "23:45", as in HourPicker.razor. */
export const hourOptions: readonly string[] = Array.from({ length: 24 * 4 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

export function isValidHour(value: string): boolean {
  return hourOptions.includes(value);
}
