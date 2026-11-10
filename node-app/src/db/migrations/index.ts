// The list of migrations, in order. Adding a migration = a new numbered file + one line here.
// Listed explicitly (instead of scanning the folder) so it's visible what runs and in which order.
// Never edit or rename a migration that has run on any database; add a new one instead.

import type { Migration } from 'kysely/migration';
import * as m0001 from './0001-board-settings.ts';
import * as m0002 from './0002-accounts.ts';
import * as m0003 from './0003-board.ts';

export const migrations: Record<string, Migration> = {
  '0001-board-settings': m0001,
  '0002-accounts': m0002,
  '0003-board': m0003,
};
