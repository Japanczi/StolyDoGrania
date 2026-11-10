// "Zapisy na gry" – the board, the landing page at "/" (alias "/stoly"). Port of Components/Pages/Tables.razor.
// Phase 1 only renders a placeholder inside the layout; the tables arrive in phase 3.

import type { FastifyInstance } from 'fastify';
import { sendPage } from '../../respond.ts';
import { boardPlaceholder } from './view.ts';

export async function boardRoutes(app: FastifyInstance): Promise<void> {
  for (const path of ['/', '/stoly']) {
    app.get(path, async (request, reply) =>
      sendPage(request, reply, { title: 'Zapisy na gry', body: boardPlaceholder() }));
  }
}
