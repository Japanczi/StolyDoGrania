// "/admin/logs" – the read-only action log, admins only. Port of Components/Pages/Admin/Logs.razor.

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../../db/database.ts';
import { loadLogPage, logActions, type LogAction, type LogPage } from '../../../db/queries/logs.ts';
import { requireUser, sendPage } from '../../respond.ts';
import { viewerOf } from '../board/routes.ts';
import { logsPage } from './logs-view.ts';

export function logsRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get('/admin/logs', async (request, reply) => {
    if (!requireUser(request, reply)) {
      return reply;
    }
    // Checked on the server, not only by hiding the menu link.
    if (!viewerOf(request).isAdmin) {
      return reply.redirect('/Account/AccessDenied', 302);
    }
    const query = request.query as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    const action = logActions.find((a): a is LogAction => a === text(query.action)) ?? null;
    const search = text(query.q).slice(0, 100);
    const requested = Number.parseInt(text(query.page), 10);
    const page = Number.isInteger(requested) && requested > 1 ? requested - 1 : 0;

    let data: LogPage;
    try {
      data = await loadLogPage(db, { action, search, page });
    } catch (error) {
      request.log.error(error);
      const empty: LogPage = { rows: [], total: 0, page: 0, pageCount: 1 };
      return sendPage(request, reply, {
        enhance: true,
        title: 'Dziennik',
        body: logsPage({ data: empty, action, search, error: 'Nie udało się wczytać dziennika.' }),
      });
    }
    return sendPage(request, reply, { title: 'Dziennik', enhance: true, body: logsPage({ data, action, search }) });
  });
}
