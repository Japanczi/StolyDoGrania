// TEMPORARY – the Google sign-up sheet import. Port of PlayTable.ApplyImport (Data/Table/PlayTable.cs), kept here
// instead of in domain/play-table.ts so the whole import can be deleted in one go.

import { maxTakenSlots, type PlayTable, type TableSlot } from '../domain/play-table.ts';
import type { SheetTableRow } from './sheet-parser.ts';

/**
 * Makes a table match a row of the sign-up sheet: title, table kind, hour, seat count, imported players and
 * "Zajęte" marks. Seats taken in the app are kept; one whose seat the sheet now gives to someone else, or that is
 * past the new seat count, moves to the lowest free seat. Returns the names of app players who no longer fit.
 * The caller sets the game.
 */
export function applyImport(table: PlayTable, row: SheetTableRow): string[] {
  table.gameTitle = row.title;
  table.kind = row.kind;
  table.maxPlayers = row.maxPlayers;
  // Only the hour is stored (no date), so the sheet's hour is simply copied.
  table.startHour = row.start;

  // Desired seats: the sheet's players first, then app players where they sit, then displaced app players.
  const desired = new Map<number, TableSlot>();
  for (const [seat, name] of row.players) {
    if (seat >= 1 && seat <= table.maxPlayers) {
      desired.set(seat, { slotNumber: seat, participantName: name, userId: null, isImported: true });
    }
  }

  const appSeats = table.participants.filter(p => p.isImported !== true).toSorted((a, b) => a.slotNumber - b.slotNumber);
  const displaced: TableSlot[] = [];
  for (const seat of appSeats) {
    if (seat.slotNumber <= table.maxPlayers && !desired.has(seat.slotNumber)) {
      desired.set(seat.slotNumber, { slotNumber: seat.slotNumber, participantName: seat.participantName, userId: seat.userId });
    } else {
      displaced.push(seat);
    }
  }

  const dropped: string[] = [];
  for (const seat of displaced) {
    let free = 0;
    for (let n = 1; n <= table.maxPlayers; n++) {
      if (!desired.has(n)) {
        free = n;
        break;
      }
    }
    if (free === 0) {
      dropped.push(seat.participantName);
      continue;
    }
    desired.set(free, { slotNumber: free, participantName: seat.participantName, userId: seat.userId });
  }

  table.participants = [...desired.values()].sort((a, b) => a.slotNumber - b.slotNumber);
  table.takenSlots = Math.min(row.takenSlots, maxTakenSlots(table));
  return dropped;
}
