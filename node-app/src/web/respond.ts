// Helpers for sending rendered pages from route handlers.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SafeHtml } from './html.ts';
import { layout } from './layout.ts';

/** Wraps a page body in the layout and sends it as an HTML response. */
export function sendPage(
  request: FastifyRequest,
  reply: FastifyReply,
  page: { title: string; body: SafeHtml },
  statusCode = 200,
): FastifyReply {
  const document = layout({
    title: page.title,
    currentPath: pathOf(request.url),
    user: null, // Phase 2: the signed-in user from the session.
    body: page.body,
  });
  return reply.code(statusCode).type('text/html; charset=utf-8').send(document.value);
}

/** The path part of a request URL, without the query string. */
function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
