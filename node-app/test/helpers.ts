// Shared test setup: a fresh in-memory database with every migration applied, an app built on it,
// a fake mailer that records e-mails, and a tiny "browser" that keeps cookies between requests.

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password-hash.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, type Db } from '../src/db/database.ts';
import { migrateToLatest } from '../src/db/migrator.ts';
import { createUser, type User } from '../src/db/queries/users.ts';
import type { Role } from '../src/db/schema.ts';
import type { EmailMessage, Mailer } from '../src/integrations/email/mailer.ts';

export const testConfig: Config = {
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  logLevel: 'silent',
  publicUrl: 'http://localhost',
  secret: 'test-secret-0123456789-0123456789-0123456789',
  email: null,
  adminSeed: null,
};

export async function createTestDb(): Promise<Db> {
  const db = openDatabase(':memory:');
  await migrateToLatest(db);
  return db;
}

/** A mailer that only remembers what it was asked to send. */
export class RecordingMailer implements Mailer {
  readonly sendsEmail = true;
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** The (only) link in the last e-mail, as a path + query on our site. */
  lastLink(): string {
    const text = this.sent.at(-1)?.text ?? '';
    const url = /http:\/\/localhost(\/\S+)/.exec(text)?.[1];
    if (!url) {
      throw new Error(`No link in the last e-mail: ${text}`);
    }
    return url;
  }
}

export type TestApp = { app: FastifyInstance; db: Db; mailer: RecordingMailer; close: () => Promise<void> };

/** Builds the app on a fresh database. Call `close()` in `t.after` to release both. */
export async function createTestApp(config: Partial<Config> = {}, mailer = new RecordingMailer()): Promise<TestApp> {
  const db = await createTestDb();
  const app = await buildApp({ config: { ...testConfig, ...config }, db, mailer });
  return {
    app,
    db,
    mailer,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}

/** Creates an account directly in the database (confirmed unless told otherwise). */
export async function addUser(
  db: Db, userName: string, password: string, opts: { email?: string; role?: Role; confirmed?: boolean } = {},
): Promise<User> {
  const result = await createUser(db, {
    userName,
    email: opts.email ?? `${userName.toLowerCase().replaceAll(' ', '.')}@example.com`,
    passwordHash: await hashPassword(password),
    emailConfirmed: opts.confirmed ?? true,
    role: opts.role ?? 'user',
  });
  if (!result.ok) {
    throw new Error(`addUser: ${result.taken} taken`);
  }
  return result.user;
}

/**
 * Sends requests like a browser would: remembers cookies, and fills in the CSRF field from the csrf cookie
 * (the page's hidden field holds the same value).
 */
export class TestBrowser {
  readonly app: FastifyInstance;
  readonly cookies = new Map<string, string>();

  constructor(app: FastifyInstance) {
    this.app = app;
  }

  async get(url: string): Promise<LightMyRequestResponse> {
    return this.remember(await this.app.inject({ method: 'GET', url, headers: this.headers() }));
  }

  /** Posts a form. Pass `csrf: null` to leave the token out, `headers` to add e.g. Sec-Fetch-Site. */
  async post(
    url: string, fields: Record<string, string>, opts: { csrf?: string | null; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> {
    if (this.csrfCookie() === undefined) {
      await this.get('/');
    }
    const csrf = opts.csrf === undefined ? this.csrfCookie() : opts.csrf;
    const body = new URLSearchParams({ ...fields, ...(csrf !== null && csrf !== undefined ? { _csrf: csrf } : {}) });
    return this.remember(await this.app.inject({
      method: 'POST',
      url,
      headers: { ...this.headers(), 'content-type': 'application/x-www-form-urlencoded', ...opts.headers },
      payload: body.toString(),
    }));
  }

  /** Logs in through the real login form. */
  async login(login: string, password: string): Promise<LightMyRequestResponse> {
    return this.post('/Account/Login', { Email: login, Password: password });
  }

  /** The CSRF cookie: "csrf" locally, "__Host-csrf" in production. */
  csrfCookie(): string | undefined {
    return this.cookies.get('csrf') ?? this.cookies.get('__Host-csrf');
  }

  private headers(): Record<string, string> {
    return this.cookies.size === 0 ? {} : { cookie: [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') };
  }

  private remember(res: LightMyRequestResponse): LightMyRequestResponse {
    for (const c of res.cookies as { name: string; value: string; expires?: Date; maxAge?: number }[]) {
      const expired = c.value === '' || c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now());
      if (expired) {
        this.cookies.delete(c.name);
      } else {
        this.cookies.set(c.name, decodeURIComponent(c.value));
      }
    }
    return res;
  }
}
