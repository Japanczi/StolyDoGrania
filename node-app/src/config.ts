// Reads and validates the app's settings from environment variables, once, at startup.
// The counterpart of appsettings.json + IOptions<T> + user-secrets in the .NET app: values come from `.env`
// locally (loaded by `node --env-file-if-exists=.env`) and from the systemd environment file on the server.

export type Environment = 'development' | 'production' | 'test';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type EmailSecurity = 'starttls' | 'ssl' | 'none';

/** SMTP settings ("Email" section in the .NET app). Null when EMAIL_HOST isn't set: then no e-mail is sent. */
export type EmailConfig = {
  host: string;
  port: number;
  /** starttls (587, default), ssl (465, encrypted from the start) or none (local test servers only). */
  security: EmailSecurity;
  /** SMTP login; empty = don't authenticate (local test servers). */
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
};

/** The main admin (Owner) created at startup ("Admin" section in the .NET app). Null when not configured. */
export type AdminSeedConfig = {
  userName: string;
  email: string;
  password: string;
};

export type Config = {
  environment: Environment;
  host: string;
  port: number;
  /** SQLite file path, or ':memory:' for a throw-away database (tests). */
  databasePath: string;
  logLevel: LogLevel;
  /** Address the app is reached at from outside, without a trailing slash; used for links in e-mails. */
  publicUrl: string;
  /** Secret for signing CSRF tokens. Must be long and random in production. */
  secret: string;
  email: EmailConfig | null;
  adminSeed: AdminSeedConfig | null;
};

const environments: readonly Environment[] = ['development', 'production', 'test'];
const logLevels: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const emailSecurities: readonly EmailSecurity[] = ['starttls', 'ssl', 'none'];

/** Used only outside production, so local runs and tests work without setting a secret. Never secret. */
const developmentSecret = 'development-only-secret-do-not-use-in-production-0123456789';

/** Thrown when a setting is missing or invalid, so the app stops before it starts serving. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Builds the config from an environment (defaults to `process.env`).
 * Every problem is collected and reported at once, so one start-up shows all mistakes.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const environment = oneOf(env.NODE_ENV ?? 'development', environments, 'NODE_ENV', problems);
  const logLevel = oneOf(env.LOG_LEVEL ?? 'info', logLevels, 'LOG_LEVEL', problems);
  const port = parsePort(env.PORT ?? '5180', 'PORT', problems);

  const host = env.HOST ?? '127.0.0.1';
  const databasePath = env.DATABASE_PATH ?? 'data/planszowkarz.db';
  if (databasePath.trim() === '') {
    problems.push('DATABASE_PATH must not be empty.');
  }

  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(publicUrl)) {
    problems.push(`PUBLIC_URL must look like https://example.com (got "${env.PUBLIC_URL}").`);
  }

  let secret = env.APP_SECRET ?? '';
  if (secret === '' && environment !== 'production') {
    secret = developmentSecret;
  } else if (secret.length < 32) {
    problems.push('APP_SECRET must be at least 32 characters (generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'base64url\'))").');
  }

  const email = readEmailConfig(env, problems);
  const adminSeed = readAdminSeed(env, problems);

  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }

  // The casts are safe: oneOf() only returns values from the list, and problems would have thrown otherwise.
  return {
    environment: environment as Environment,
    host,
    port,
    databasePath,
    logLevel: logLevel as LogLevel,
    publicUrl,
    secret,
    email,
    adminSeed,
  };
}

function readEmailConfig(env: NodeJS.ProcessEnv, problems: string[]): EmailConfig | null {
  const host = env.EMAIL_HOST ?? '';
  if (host === '') {
    return null;
  }
  const security = oneOf(env.EMAIL_SECURITY ?? 'starttls', emailSecurities, 'EMAIL_SECURITY', problems);
  const fromAddress = env.EMAIL_FROM_ADDRESS ?? '';
  if (fromAddress === '') {
    problems.push('EMAIL_FROM_ADDRESS is required when EMAIL_HOST is set.');
  }
  return {
    host,
    port: parsePort(env.EMAIL_PORT ?? '587', 'EMAIL_PORT', problems),
    security: security ?? 'starttls',
    user: env.EMAIL_USER ?? '',
    password: env.EMAIL_PASSWORD ?? '',
    fromAddress,
    fromName: env.EMAIL_FROM_NAME ?? 'Planszówkarz',
  };
}

function readAdminSeed(env: NodeJS.ProcessEnv, problems: string[]): AdminSeedConfig | null {
  const userName = env.ADMIN_USER_NAME ?? '';
  const email = env.ADMIN_EMAIL ?? '';
  const password = env.ADMIN_PASSWORD ?? '';
  const given = [userName, email, password].filter(v => v !== '').length;
  if (given === 0) {
    return null;
  }
  if (given < 3) {
    problems.push('ADMIN_USER_NAME, ADMIN_EMAIL and ADMIN_PASSWORD must be set together (or none of them).');
  }
  return { userName, email, password };
}

function parsePort(text: string, name: string, problems: string[]): number {
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`${name} must be a whole number from 1 to 65535 (got "${text}").`);
  }
  return port;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string, problems: string[]): T | null {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  problems.push(`${name} must be one of ${allowed.join(', ')} (got "${value}").`);
  return null;
}
