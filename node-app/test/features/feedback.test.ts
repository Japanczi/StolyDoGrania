import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { countFeedback, deleteFeedback, packFeedback, saveComment } from '../../src/features/feedback.ts';
import { addUser, createTestApp, TestBrowser } from '../helpers.ts';
import { readZip } from './zip-reader.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'feedback-'));
}

test('saveComment writes the same file as the .NET app', () => {
  const dir = join(tempDir(), 'Feedback');
  try {
    const now = new Date(2026, 10, 9, 14, 5, 7);
    const { fileName } = saveComment(dir, { userId: 'abc-123', userName: 'jan@example.com' }, '/stoly?x=1', '  Fajnie.\nDruga linia.  ', now);
    assert.match(fileName, /^20261109-140507-[0-9a-f]{6}\.md$/);
    assert.equal(readFileSync(join(dir, fileName), 'utf8'), [
      '---',
      'date: 2026-11-09 14:05:07',
      'page: /stoly?x=1',
      'user: jan',
      'userName: jan@example.com',
      'userId: abc-123',
      '---',
      '',
      'Fajnie.',
      'Druga linia.',
      '',
    ].join('\n'));
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true });
  }
});

test('count, pack and delete', () => {
  const dir = tempDir();
  try {
    assert.equal(countFeedback(join(dir, 'missing')), 0);
    assert.equal(packFeedback(join(dir, 'missing'), new Date()), null);
    saveComment(dir, { userId: 'u1', userName: 'Ala' }, '/', 'jeden', new Date(2026, 0, 1, 10, 0, 0));
    saveComment(dir, { userId: 'u2', userName: 'Ola' }, '/', 'dwa', new Date(2026, 0, 1, 10, 0, 1));
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    assert.equal(countFeedback(dir), 2);

    const packed = packFeedback(dir, new Date(2026, 11, 31, 23, 59, 58));
    assert.ok(packed);
    assert.equal(packed.fileName, 'uwagi-20261231-235958.zip');
    assert.equal(packed.files.length, 2);
    const zipped = readZip(packed.bytes);
    assert.deepEqual([...zipped.keys()].sort(), readdirSync(dir).filter(f => f.endsWith('.md')).sort());
    assert.ok([...zipped.values()].some(data => data.toString().includes('jeden')));

    deleteFeedback(packed.files);
    deleteFeedback(packed.files); // already gone: skipped
    assert.equal(countFeedback(dir), 0);
    assert.equal(readdirSync(dir).length, 1); // notes.txt untouched
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/feedback: refuses anonymous users, validates, saves for logged-in ones', async () => {
  const root = tempDir();
  const dir = join(root, 'Feedback');
  const { app, db, close } = await createTestApp({ feedbackDir: dir });
  try {
    await app.ready();
    await addUser(db, 'Jan Nowak', 'Haslo123!x');

    const anonymous = new TestBrowser(app);
    const denied = await anonymous.postJson('/api/feedback', { message: 'hej', page: '/' });
    assert.equal(denied.statusCode, 401);
    assert.equal(countFeedback(dir), 0);

    const browser = new TestBrowser(app);
    await browser.login('jan.nowak@example.com', 'Haslo123!x');
    assert.equal((await browser.postJson('/api/feedback', { message: '   ' })).statusCode, 400);
    assert.equal((await browser.postJson('/api/feedback', { message: 'x'.repeat(4001) })).statusCode, 400);
    assert.equal((await browser.postJson('/api/feedback', { message: 'hej' }, { csrf: null })).statusCode, 403);
    assert.equal(countFeedback(dir), 0);

    const ok = await browser.postJson('/api/feedback', { message: 'Ładna strona', page: '/stoly\nuserId: evil' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().ok, true);
    const [file] = readdirSync(dir);
    assert.ok(file);
    const content = readFileSync(join(dir, file), 'utf8');
    assert.match(content, /\npage: \/stoly userId: evil\n/); // newline flattened: no injected key
    assert.match(content, /\nuser: Jan Nowak\nuserName: Jan Nowak\nuserId: [^\n]+\n---\n\nŁadna strona\n$/);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
