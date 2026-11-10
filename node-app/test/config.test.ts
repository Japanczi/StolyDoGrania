import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  test('uses development defaults when nothing is set', () => {
    assert.deepEqual(loadConfig({}), {
      environment: 'development',
      host: '127.0.0.1',
      port: 5180,
      databasePath: 'data/planszowkarz.db',
      logLevel: 'info',
    });
  });

  test('reads every setting from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '30347', DATABASE_PATH: '/opt/p/app.db', LOG_LEVEL: 'warn',
    });
    assert.equal(config.environment, 'production');
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 30347);
    assert.equal(config.databasePath, '/opt/p/app.db');
    assert.equal(config.logLevel, 'warn');
  });

  test('reports every invalid setting at once', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'staging', PORT: 'abc', LOG_LEVEL: 'loud', DATABASE_PATH: ' ' }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /NODE_ENV/);
        assert.match(err.message, /PORT/);
        assert.match(err.message, /LOG_LEVEL/);
        assert.match(err.message, /DATABASE_PATH/);
        return true;
      },
    );
  });

  test('rejects ports out of range', () => {
    assert.throws(() => loadConfig({ PORT: '70000' }), ConfigError);
    assert.throws(() => loadConfig({ PORT: '0' }), ConfigError);
  });
});
