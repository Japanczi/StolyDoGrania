// Helpers for route handlers: sending pages, and requiring a logged-in user.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionUser } from '../auth/sessions.ts';
import { shortName } from '../domain/user-name.ts';
import type { SafeHtml } from './html.ts';
import { layout } from './layout.ts';

/** Wraps a page body in the layout and sends it as an HTML response. */
export function sendPage(
  request: FastifyRequest,
  reply: FastifyReply,
  page: { title: string; body: SafeHtml; head?: SafeHtml; scripts?: SafeHtml },
  statusCode = 200,
): FastifyReply {
  const user = request.user;
  const document = layout({
    title: page.title,
    currentPath: pathOf(request.url),
    user: user && { shortName: shortName(user.userName), isAdmin: user.role !== 'user' },
    csrfToken: request.csrfToken,
    body: page.body,
    ...(page.head ? { head: page.head } : {}),
    ...(page.scripts ? { scripts: page.scripts } : {}),
  });
  return reply.code(statusCode).type('text/html; charset=utf-8').send(document.value);
}

/**
 * The logged-in user, or null after sending a redirect to the login page (which comes back here afterwards).
 * The counterpart of [Authorize] on a page. Usage: `const user = requireUser(request, reply); if (!user) return reply;`
 */
export function requireUser(request: FastifyRequest, reply: FastifyReply): SessionUser | null {
  if (request.user) {
    return request.user;
  }
  void reply.redirect(`/Account/Login?ReturnUrl=${encodeURIComponent(request.url)}`, 302);
  return null;
}

/** The path part of a request URL, without the query string. */
export function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
