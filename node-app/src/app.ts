// Builds the Fastify application: hooks, static files, routes, error pages.
// The top half of Program.cs (services + middleware pipeline). Kept separate from server.ts so tests can
// build the app and send fake requests with app.inject(), without opening a port.

import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRequestAuth } from './auth/request-auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db/database.ts';
import { createNoOpMailer, createSmtpMailer, type Mailer } from './integrations/email/mailer.ts';
import { healthRoutes } from './web/health.ts';
import { manageRoutes } from './web/pages/account/manage-routes.ts';
import { accountRoutes } from './web/pages/account/routes.ts';
import { boardRoutes } from './web/pages/board/routes.ts';
import { errorPage, notFoundPage } from './web/pages/errors/view.ts';
import { sendPage } from './web/respond.ts';

export type AppDeps = {
  config: Config;
  db: Db;
  /** Tests pass a fake that records messages; otherwise SMTP (EMAIL_HOST set) or no e-mail at all. */
  mailer?: Mailer;
};

export async function buildApp({ config, db, mailer }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.environment === 'test' ? 'silent' : config.logLevel },
    // ASP.NET Core matches URLs case-insensitively (/account/login = /Account/Login); keep old links working.
    routerOptions: { caseSensitive: false, ignoreTrailingSlash: true },
  });
  const emailSender = mailer
    ?? (config.email ? createSmtpMailer(config.email, app.log) : createNoOpMailer(app.log, config.environment === 'development'));

  // Cookies (sessions, CSRF, flash messages) and HTML form posts (application/x-www-form-urlencoded).
  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  // Who is logged in + CSRF checks, for every request (UseAuthentication + UseAntiforgery).
  registerRequestAuth(app, config, db);

  // A few protective response headers on every response (ASP.NET Core sets some of these via UseHsts etc.).
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // Files from public/ at the site root: /css/app.css, /js/layout.js … (app.UseStaticFiles / MapStaticAssets).
  await app.register(fastifyStatic, {
    root: join(import.meta.dirname, '..', 'public'),
    index: false,
  });

  healthRoutes(app, db);
  await app.register(boardRoutes);
  accountRoutes(app, { config, db, mailer: emailSender });
  manageRoutes(app, { config, db, mailer: emailSender });

  // Unknown URL → Polish 404 page (UseStatusCodePagesWithReExecute("/not-found") in .NET).
  app.setNotFoundHandler(async (request, reply) =>
    sendPage(request, reply, { title: 'Nie znaleziono strony', body: notFoundPage() }, 404));

  // Unexpected error → log it and show the error page (UseExceptionHandler("/Error") in .NET).
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = statusCodeOf(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Request failed');
    }
    const details = config.environment === 'development' && error instanceof Error
      ? (error.stack ?? error.message)
      : null;
    return sendPage(request, reply, { title: 'Błąd', body: errorPage(request.id, details) }, statusCode);
  });

  return app;
}

/** Fastify marks client errors (bad JSON, too large…) with a 4xx statusCode; everything else is a 500. */
function statusCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = error.statusCode;
    if (typeof code === 'number' && code >= 400 && code < 600) {
      return code;
    }
  }
  return 500;
}
