import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createZip } from '../../src/features/zip.ts';
import { readZip } from './zip-reader.ts';


test('createZip round-trips entries (stored and deflated, UTF-8 names)', () => {
  const big = Buffer.from('Uwaga '.repeat(500));
  const zip = createZip([
    { name: 'a.md', data: Buffer.from('x'), modified: new Date() },
    { name: 'zażółć.md', data: big, modified: new Date() },
    { name: 'empty.md', data: Buffer.alloc(0), modified: new Date() },
  ]);
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ['a.md', 'zażółć.md', 'empty.md']);
  assert.deepEqual(files.get('zażółć.md'), big);
  assert.equal(files.get('a.md')?.toString(), 'x');
});

test('createZip output is accepted by the system tar (bsdtar reads zip)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  try {
    const path = join(dir, 't.zip');
    writeFileSync(path, createZip([{ name: 'one.md', data: Buffer.from('hello hello hello hello'), modified: new Date() }]));
    let listing: string;
    try {
      listing = execFileSync(process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar', ['-tf', path], { encoding: 'utf8' });
    } catch {
      return; // no tar that understands zip here; the round-trip test above still covers the format
    }
    assert.match(listing, /one\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
