// HTTP-level tests: app.inject() sends a fake request through the whole Fastify pipeline without a network,
// like WebApplicationFactory in ASP.NET Core tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createTestApp } from '../helpers.ts';
import { layout } from '../../src/web/layout.ts';
import { html } from '../../src/web/html.ts';

describe('pages', () => {
  for (const url of ['/', '/stoly']) {
    test(`${url} shows the board inside the layout`, async t => {
      const { app, close } = await createTestApp();
      t.after(close);

      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'] ?? '', /^text\/html; charset=utf-8/);
      assert.match(res.body, /^<!DOCTYPE html>\n<html lang="pl">/);
      assert.match(res.body, /<title>Zapisy na gry<\/title>/);
      assert.match(res.body, /<h1>Zapisy na gry<\/h1>/);
      // Logged out: ribbon login button, drawer register/login links, BGG credit.
      assert.match(res.body, /href="\/Account\/Login\?ReturnUrl=%2F">Zaloguj się</);
      assert.match(res.body, /Zarejestruj się/);
      assert.match(res.body, /powered-by-bgg\.png/);
      // "Zapisy na gry" is the active drawer entry on both aliases.
      assert.match(res.body, /class="drawer-link active" href="\/" aria-current="page"/);
    });
  }

  test('unknown URLs get the Polish 404 page', async t => {
    const { app, close } = await createTestApp();
    t.after(close);

    const res = await app.inject({ method: 'GET', url: '/nie-ma-takiej-strony' });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /Nie znaleziono strony/);
    assert.match(res.body, /<html lang="pl">/);
  });

  test('every response carries the protective headers', async t => {
    const { app, close } = await createTestApp();
    t.after(close);

    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });
});

describe('static files', () => {
  for (const [url, type] of [
    ['/css/app.css', /text\/css/],
    ['/css/layout.css', /text\/css/],
    ['/lib/bootstrap/css/bootstrap.min.css', /text\/css/],
    ['/js/layout.js', /javascript/],
    ['/images/powered-by-bgg.png', /image\/png/],
    ['/favicon.png', /image\/png/],
  ] as const) {
    test(`${url} is served`, async t => {
      const { app, close } = await createTestApp();
      t.after(close);

      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'] ?? '', type);
    });
  }

  test('a missing static file gets the 404 page', async t => {
    const { app, close } = await createTestApp();
    t.after(close);

    const res = await app.inject({ method: 'GET', url: '/css/nope.css' });
    assert.equal(res.statusCode, 404);
  });

  test('files outside public/ are not reachable', async t => {
    const { app, close } = await createTestApp();
    t.after(close);

    const res = await app.inject({ method: 'GET', url: '/../package.json' });
    assert.notEqual(res.statusCode, 200);
  });
});

describe('errors', () => {
  test('an unexpected error shows the error page with the stack only in development', async t => {
    for (const [environment, showsStack] of [['development', true], ['production', false]] as const) {
      const { app, close } = await createTestApp({ environment, logLevel: 'silent' });
      t.after(close);
      app.get('/boom', async () => { throw new Error('Test failure <b>'); });

      const res = await app.inject({ method: 'GET', url: '/boom' });
      assert.equal(res.statusCode, 500);
      assert.match(res.body, /Wystąpił błąd/);
      assert.equal(res.body.includes('Test failure &lt;b&gt;'), showsStack, environment);
    }
  });
});

describe('health', () => {
  test('/health reports the database as ok', async t => {
    const { app, close } = await createTestApp();
    t.after(close);

    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });
});

describe('layout', () => {
  test('a signed-in user sees the profile button and logout; never more than the short name', () => {
    const page = layout({
      title: 'T', currentPath: '/', user: { shortName: 'jan', isAdmin: false }, body: html`<p>x</p>`,
    }).value;
    assert.match(page, /class="btn btn-outline-light btn-sm app-user" href="\/Account\/Manage" title="Profil">jan</);
    assert.match(page, /Wyloguj/);
    assert.doesNotMatch(page, /Zaloguj się/);
    assert.doesNotMatch(page, /Użytkownicy/);
  });

  test('admins see the admin entries in the drawer', () => {
    const page = layout({
      title: 'T', currentPath: '/admin/logs', user: { shortName: 'ola', isAdmin: true }, body: html``,
    }).value;
    assert.match(page, /href="\/admin\/users"/);
    assert.match(page, /class="drawer-link active" href="\/admin\/logs"/);
  });

  test('the page title and user name are escaped', () => {
    const page = layout({
      title: '<x>', currentPath: '/', user: { shortName: '<img>', isAdmin: false }, body: html``,
    }).value;
    assert.match(page, /<title>&lt;x&gt;<\/title>/);
    assert.doesNotMatch(page, /<img>/);
  });
});
