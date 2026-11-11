// GET /health – a small JSON answer proving the server and the database respond.
// Useful for the deploy script and the side-by-side check later; shows nothing private.

import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';

export function healthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/health', async (_request, reply) => {
    const settings = await db.selectFrom('board_settings').select('id').executeTakeFirst();
    return reply.send({ status: settings ? 'ok' : 'database-empty' });
  });
}
