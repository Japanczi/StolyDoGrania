import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readDiskUsage } from '../../src/features/disk-usage.ts';

test('readDiskUsage sums database files and the feedback folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disk-'));
  try {
    const db = join(dir, 'app.db');
    writeFileSync(db, Buffer.alloc(1000));
    writeFileSync(`${db}-wal`, Buffer.alloc(200));
    writeFileSync(`${db}-shm`, Buffer.alloc(30));
    const feedback = join(dir, 'Feedback');
    mkdirSync(join(feedback, 'sub'), { recursive: true });
    writeFileSync(join(feedback, 'a.md'), Buffer.alloc(10));
    writeFileSync(join(feedback, 'sub', 'b.md'), Buffer.alloc(5));

    const now = new Date();
    const report = readDiskUsage(db, feedback, now);
    assert.equal(report.database, 1230);
    assert.equal(report.feedback, 15);
    assert.equal(report.readAt, now);
    assert.ok(report.driveTotal > 0 && report.driveFree >= 0 && report.driveFree <= report.driveTotal);
    assert.equal(report.driveUsed, report.driveTotal - report.driveFree);
    assert.ok(report.usedPercent >= 0 && report.usedPercent <= 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDiskUsage copes with missing files and an in-memory database', () => {
  const report = readDiskUsage(':memory:', join(tmpdir(), 'definitely-missing-feedback-dir'));
  assert.equal(report.database, 0);
  assert.equal(report.feedback, 0);
  assert.ok(report.driveTotal > 0);
});
