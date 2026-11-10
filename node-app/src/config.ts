// Reads and validates the app's settings from environment variables, once, at startup.
// The counterpart of appsettings.json + IOptions<T> + user-secrets in the .NET app: values come from `.env`
// locally (loaded by `node --env-file-if-exists=.env`) and from the systemd environment file on the server.

export type Environment = 'development' | 'production' | 'test';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type Config = {
  environment: Environment;
  host: string;
  port: number;
  /** SQLite file path, or ':memory:' for a throw-away database (tests). */
  databasePath: string;
  logLevel: LogLevel;
};

const environments: readonly Environment[] = ['development', 'production', 'test'];
const logLevels: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

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

  const portText = env.PORT ?? '5180';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be a whole number from 1 to 65535 (got "${portText}").`);
  }

  const host = env.HOST ?? '127.0.0.1';
  const databasePath = env.DATABASE_PATH ?? 'data/planszowkarz.db';
  if (databasePath.trim() === '') {
    problems.push('DATABASE_PATH must not be empty.');
  }

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
  };
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string, problems: string[]): T | null {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  problems.push(`${name} must be one of ${allowed.join(', ')} (got "${value}").`);
  return null;
}
