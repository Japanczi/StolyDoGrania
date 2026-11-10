import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  test('uses development defaults when nothing is set', () => {
    const config = loadConfig({});
    assert.deepEqual({ ...config, secret: '(dev)' }, {
      environment: 'development',
      host: '127.0.0.1',
      port: 5180,
      databasePath: 'data/planszowkarz.db',
      logLevel: 'info',
      publicUrl: 'http://localhost:5180',
      secret: '(dev)',
      email: null,
      adminSeed: null,
    });
    assert.ok(config.secret.length >= 32, 'a development secret is filled in');
  });

  const secret = 'a-production-secret-0123456789-0123456789';

  test('reads every setting from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '30347', DATABASE_PATH: '/opt/p/app.db', LOG_LEVEL: 'warn',
      PUBLIC_URL: 'https://planszowkarz.example/', APP_SECRET: secret,
      ADMIN_USER_NAME: 'Szef', ADMIN_EMAIL: 'szef@example.com', ADMIN_PASSWORD: 'Tajne1!',
      EMAIL_HOST: 'smtp.example.com', EMAIL_PORT: '465', EMAIL_SECURITY: 'ssl', EMAIL_USER: 'u', EMAIL_PASSWORD: 'p',
      EMAIL_FROM_ADDRESS: 'app@example.com',
    });
    assert.equal(config.environment, 'production');
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 30347);
    assert.equal(config.databasePath, '/opt/p/app.db');
    assert.equal(config.logLevel, 'warn');
    assert.equal(config.publicUrl, 'https://planszowkarz.example', 'trailing slash removed');
    assert.equal(config.secret, secret);
    assert.deepEqual(config.adminSeed, { userName: 'Szef', email: 'szef@example.com', password: 'Tajne1!' });
    assert.deepEqual(config.email, {
      host: 'smtp.example.com', port: 465, security: 'ssl', user: 'u', password: 'p', fromAddress: 'app@example.com', fromName: 'Planszówkarz',
    });
  });

  test('production requires a long APP_SECRET', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /APP_SECRET/);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_SECRET: 'short' }), /APP_SECRET/);
  });

  test('admin seed settings come all together or not at all', () => {
    assert.throws(() => loadConfig({ ADMIN_USER_NAME: 'Szef' }), /ADMIN_USER_NAME, ADMIN_EMAIL and ADMIN_PASSWORD/);
  });

  test('e-mail needs a sender address', () => {
    assert.throws(() => loadConfig({ EMAIL_HOST: 'smtp.example.com' }), /EMAIL_FROM_ADDRESS/);
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
