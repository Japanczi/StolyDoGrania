import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { designerRoutes, designFileName, toSlug } from '../../src/dev/designer.ts';
import { createTestApp, TestBrowser } from '../helpers.ts';

test('toSlug and file name', () => {
  assert.equal(toSlug('/stoly?x=1'), 'stoly-x-1');
  assert.equal(toSlug(null), 'root');
  assert.equal(toSlug('/'), 'root');
  assert.equal(toSlug('../../etc/passwd'), 'etc-passwd');
  assert.equal(toSlug(`/${'a'.repeat(100)}`).length, 60);
  assert.equal(designFileName('/stoly', new Date(2026, 10, 9, 8, 3, 2)), '20261109-080302-stoly.json');
});

test('POST /_designer/save writes the JSON when enabled', async () => {
  const root = mkdtempSync(join(tmpdir(), 'designs-'));
  const dir = join(root, 'Designs');
  const { app, close } = await createTestApp();
  try {
    designerRoutes(app, { dir, enabled: true });
    await app.ready();
    const browser = new TestBrowser(app);
    const design = { page: '/stoly', comments: [{ text: 'Zażółć' }] };

    assert.equal((await browser.postJson('/_designer/save', design, { csrf: null })).statusCode, 403);
    const res = await browser.postJson('/_designer/save', design);
    assert.equal(res.statusCode, 200);
    const [file] = readdirSync(dir);
    assert.ok(file);
    assert.match(file, /^\d{8}-\d{6}-stoly\.json$/);
    assert.equal(res.json().file, `Claude_Resources/Tools/Designs/${file}`);
    assert.equal(readFileSync(join(dir, file), 'utf8'), JSON.stringify(design, null, 2));
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the route does not exist when disabled', async () => {
  const { app, close } = await createTestApp();
  try {
    designerRoutes(app, { dir: join(tmpdir(), 'unused-designs'), enabled: false });
    await app.ready();
    assert.equal((await new TestBrowser(app).postJson('/_designer/save', { page: '/' })).statusCode, 404);
  } finally {
    await close();
  }
});
