// Reads of the action log (user_action_logs). Port of the query in Components/Pages/Admin/Logs.razor.

import { sql, type Kysely } from 'kysely';
import type { Database, UserActionLogsTable } from '../schema.ts';

export const logPageSize = 50;

export type LogAction = UserActionLogsTable['action'];
export const logActions: readonly LogAction[] = ['JoinedTable', 'RoleChanged', 'UserRemoved'];

export type LogRow = {
  id: number;
  createdUtc: string;
  action: LogAction;
  actorName: string | null;
  targetName: string | null;
  details: string | null;
};

export type LogPage = { rows: LogRow[]; total: number; page: number; pageCount: number };

/** Escapes the LIKE wildcards (and the escape character itself), so a search term is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * One page of log entries, newest first. `page` is 0-based and is clamped to the last page.
 * The search matches actor name, target name and details (parameterised LIKE, wildcards escaped).
 */
export async function loadLogPage(
  db: Kysely<Database>, opts: { action: LogAction | null; search: string; page: number },
): Promise<LogPage> {
  const term = opts.search.trim();
  const pattern = `%${escapeLike(term)}%`;
  const filtered = () => {
    let query = db.selectFrom('user_action_logs');
    if (opts.action !== null) {
      query = query.where('action', '=', opts.action);
    }
    if (term !== '') {
      query = query.where(eb => eb.or([
        eb(sql<number>`${sql.ref('actor_name')} like ${pattern} escape '\\'`, '=', 1),
        eb(sql<number>`${sql.ref('target_name')} like ${pattern} escape '\\'`, '=', 1),
        eb(sql<number>`${sql.ref('details')} like ${pattern} escape '\\'`, '=', 1),
      ]));
    }
    return query;
  };

  const counted = await filtered().select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirst();
  const total = Number(counted?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / logPageSize));
  const page = Math.min(Math.max(0, opts.page), pageCount - 1);
  const rows = await filtered()
    .select(['id', 'created_utc', 'action', 'actor_name', 'target_name', 'details'])
    .orderBy('created_utc', 'desc').orderBy('id', 'desc')
    .limit(logPageSize).offset(page * logPageSize)
    .execute();
  return {
    rows: rows.map(r => ({
      id: r.id, createdUtc: r.created_utc, action: r.action, actorName: r.actor_name, targetName: r.target_name, details: r.details,
    })),
    total, page, pageCount,
  };
}
