import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCsrfToken, csrfTokensMatch, isSameOrigin, isValidCsrfToken } from '../../src/auth/csrf.ts';

const secret = 'test-secret-0123456789-0123456789-0123456789';

describe('CSRF tokens', () => {
  test('a new token is valid with its secret only', () => {
    const token = createCsrfToken(secret);
    assert.equal(isValidCsrfToken(token, secret), true);
    assert.equal(isValidCsrfToken(token, `${secret}x`), false);
  });

  test('a forged or tampered token is invalid', () => {
    const [value] = createCsrfToken(secret).split('.');
    assert.equal(isValidCsrfToken(`${value}.forged`, secret), false);
    assert.equal(isValidCsrfToken('abc', secret), false);
    assert.equal(isValidCsrfToken(`${createCsrfToken(secret)}.extra`, secret), false);
  });

  test('the submitted token must equal the cookie token', () => {
    const token = createCsrfToken(secret);
    assert.equal(csrfTokensMatch(token, token, secret), true);
    assert.equal(csrfTokensMatch(token, createCsrfToken(secret), secret), false);
    assert.equal(csrfTokensMatch(token, undefined, secret), false);
    assert.equal(csrfTokensMatch(undefined, token, secret), false);
  });

  test('an unsigned cookie (planted by a neighbouring subdomain) is refused even if the field matches it', () => {
    assert.equal(csrfTokensMatch('planted', 'planted', secret), false);
  });
});

describe('isSameOrigin', () => {
  const hosts = ['localhost:5180'];

  test('Sec-Fetch-Site decides when present', () => {
    assert.equal(isSameOrigin({ secFetchSite: 'same-origin' }, hosts), true);
    assert.equal(isSameOrigin({ secFetchSite: 'none' }, hosts), true);
    assert.equal(isSameOrigin({ secFetchSite: 'cross-site', origin: 'http://localhost:5180' }, hosts), false);
    assert.equal(isSameOrigin({ secFetchSite: 'same-site' }, hosts), false);
  });

  test('otherwise Origin must be one of our hosts', () => {
    assert.equal(isSameOrigin({ origin: 'http://localhost:5180' }, hosts), true);
    assert.equal(isSameOrigin({ origin: 'https://evil.example' }, hosts), false);
    assert.equal(isSameOrigin({ origin: 'null' }, hosts), false);
  });

  test('with neither header the token check alone decides', () => {
    assert.equal(isSameOrigin({}, hosts), true);
  });
});
