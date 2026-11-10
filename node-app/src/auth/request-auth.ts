// Hooks that run for every request: who is logged in (session cookie) and CSRF protection.
// The counterpart of app.UseAuthentication() + app.UseAntiforgery() in Program.cs.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/database.ts';
import { createCsrfToken, csrfTokensMatch, isSameOrigin, isValidCsrfToken } from './csrf.ts';
import { loadSession, sessionLifetimeMs, type SessionUser } from './sessions.ts';

// TypeScript "declaration merging": tells the compiler that every FastifyRequest has these fields.
// Only types – erased when Node strips them; the values are attached by the hooks below.
declare module 'fastify' {
  interface FastifyRequest {
    /** The logged-in user, or null. Read fresh from the database on every request. */
    user: SessionUser | null;
    /** SHA-256 of the current session id (to log out this session), or null. */
    sessionIdHash: string | null;
    /** This browser's CSRF token, for hidden `_csrf` fields in forms. */
    csrfToken: string;
  }
}

export type CookieNames = { session: string; csrf: string };

/**
 * In production the cookies get the "__Host-" prefix: browsers then only accept them over HTTPS, from this exact
 * host, for path "/" – so a neighbouring subdomain can't plant or overwrite them. Locally (plain http) the prefix
 * would make browsers drop them, so it's left off.
 */
export function cookieNames(config: Config): CookieNames {
  return config.environment === 'production'
    ? { session: '__Host-session', csrf: '__Host-csrf' }
    : { session: 'session', csrf: 'csrf' };
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerRequestAuth(app: FastifyInstance, config: Config, db: Db): void {
  const names = cookieNames(config);
  const secure = config.environment === 'production';
  const publicHost = new URL(config.publicUrl).host;

  app.decorateRequest('user', null);
  app.decorateRequest('sessionIdHash', null);
  app.decorateRequest('csrfToken', '');

  app.addHook('onRequest', async (request, reply) => {
    // Static files need neither a session nor a CSRF cookie.
    if (isStaticFile(request.url)) {
      return;
    }

    const sessionId = request.cookies[names.session];
    if (sessionId) {
      const session = await loadSession(db, sessionId);
      if (session) {
        request.user = session.user;
        request.sessionIdHash = session.idHash;
        if (session.renewedExpires && session.persistent) {
          setSessionCookie(reply, config, sessionId, true);
        }
      } else {
        reply.clearCookie(names.session, { path: '/', secure });
      }
    }

    const csrf = request.cookies[names.csrf];
    if (csrf && isValidCsrfToken(csrf, config.secret)) {
      request.csrfToken = csrf;
    } else {
      request.csrfToken = createCsrfToken(config.secret);
      reply.setCookie(names.csrf, request.csrfToken, { path: '/', httpOnly: true, sameSite: 'lax', secure });
    }
  });

  // preHandler runs after the form body is parsed, so the hidden field can be read.
  app.addHook('preHandler', async (request, reply) => {
    if (!unsafeMethods.has(request.method)) {
      return;
    }
    const sameOrigin = isSameOrigin(
      { secFetchSite: header(request, 'sec-fetch-site'), origin: header(request, 'origin') },
      [request.host, publicHost],
    );
    const submitted = formField(request.body, '_csrf') ?? header(request, 'x-csrf-token');
    if (!sameOrigin || !csrfTokensMatch(request.cookies[names.csrf], submitted, config.secret)) {
      request.log.warn({ sameOrigin }, 'CSRF check failed');
      return reply.code(403).type('text/plain; charset=utf-8')
        .send('Błąd: formularz wygasł albo został wysłany z innej strony. Wróć, odśwież stronę i spróbuj ponownie.');
    }
  });
}

/** Sends the session cookie. "Zapamiętaj mnie" makes it outlive the browser (Max-Age); otherwise it's a session cookie. */
export function setSessionCookie(reply: FastifyReply, config: Config, sessionId: string, persistent: boolean): void {
  reply.setCookie(cookieNames(config).session, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.environment === 'production',
    ...(persistent ? { maxAge: sessionLifetimeMs / 1000 } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(cookieNames(config).session, { path: '/', secure: config.environment === 'production' });
}

function isStaticFile(url: string): boolean {
  return /^\/(css|js|lib|images|tools)\//.test(url) || url === '/favicon.png';
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function formField(body: unknown, name: string): string | undefined {
  if (typeof body === 'object' && body !== null && name in body) {
    const value = (body as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
