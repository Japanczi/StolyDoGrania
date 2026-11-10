// Disk space and data sizes for the admin toolbox. Port of Data/DiskUsage.cs. Callers check permissions.

import { statSync, statfsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type DiskReport = {
  /** Size of the disk, in bytes. */
  driveTotal: number;
  /** Space still available to the app, in bytes. */
  driveFree: number;
  /** driveTotal - driveFree. */
  driveUsed: number;
  usedPercent: number;
  /** Size of the database files (incl. -wal/-shm), in bytes. */
  database: number;
  /** Size of the saved feedback comments, in bytes. */
  feedback: number;
  readAt: Date;
};

function fileBytes(path: string): number {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

function folderBytes(folder: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      total += entry.isDirectory() ? folderBytes(path) : fileBytes(path);
    }
  } catch {
    // Missing folder: nothing stored yet.
  }
  return total;
}

/** Measures the disk the database lives on, the database files and the feedback folder. */
export function readDiskUsage(dbPath: string, feedbackDir: string, now: Date = new Date()): DiskReport {
  const isMemory = dbPath === ':memory:' || dbPath.trim() === '';
  const dbFile = isMemory ? null : resolve(dbPath);
  // The disk the app's data is on; fall back to the working directory for an in-memory database.
  const stats = statfsSync(dbFile === null ? process.cwd() : dirname(dbFile));
  const driveTotal = stats.blocks * stats.bsize;
  // bavail = space available to unprivileged processes (like DriveInfo.AvailableFreeSpace).
  const driveFree = stats.bavail * stats.bsize;
  const driveUsed = driveTotal - driveFree;
  return {
    driveTotal,
    driveFree,
    driveUsed,
    usedPercent: driveTotal > 0 ? (100 * driveUsed) / driveTotal : 0,
    database: dbFile === null ? 0 : [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].reduce((sum, p) => sum + fileBytes(p), 0),
    feedback: folderBytes(feedbackDir),
    readAt: now,
  };
}
