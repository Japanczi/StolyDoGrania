// TypeScript description of every database table, used by Kysely to type-check queries
// (a misspelt column is a compile error, as with LINQ over EF Core entities).
// Written by hand and kept in step with src/db/migrations/ – a test checks they match.
//
// SQLite has no boolean or date types: booleans are INTEGER 0/1, instants are TEXT in ISO 8601 UTC
// ("2026-11-10T18:00:00.000Z").

/** board_settings: one row (id = 1) with board-wide settings. Port of Data/Table/BoardSettings.cs. */
export type BoardSettingsTable = {
  id: number;
  /** 0/1 – the admin toolbox's "Auto" switch: clear the board every Monday 00:00 (Europe/Warsaw). */
  auto_reset_enabled: number;
  /** When the last automatic reset ran or the switch was turned on; null until first switched on. */
  auto_reset_checked_utc: string | null;
};

/** All tables, by name. */
export type Database = {
  board_settings: BoardSettingsTable;
};
