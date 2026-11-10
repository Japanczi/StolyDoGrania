// A minimal ZIP writer (Node has none built in). Layout of the file we produce:
//   [local file header + name + compressed data] x N, then [central directory entry + name] x N, then the
//   end-of-central-directory record. Compression is plain deflate (zlib.deflateRawSync), checksums are CRC-32
//   (zlib.crc32). No ZIP64: fine for a folder of small comments (limits: 65535 files, 4 GB).

import { crc32, deflateRawSync } from 'node:zlib';

export type ZipEntry = { name: string; data: Buffer; modified: Date };

const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endSignature = 0x06054b50;
const versionNeeded = 20; // 2.0 = deflate
const utf8NameFlag = 0x0800; // file names are UTF-8
const methodStored = 0;
const methodDeflate = 8;

/** MS-DOS date/time as stored in ZIP headers (2-second resolution, local time, years 1980+). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Builds a complete .zip file in memory. */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    // Keep the data as is when deflating doesn't help (tiny or already-compressed files).
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? methodDeflate : methodStored;
    const checksum = crc32(entry.data);
    const stamp = dosDateTime(entry.modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(localHeaderSignature, 0);
    local.writeUInt16LE(versionNeeded, 4);
    local.writeUInt16LE(utf8NameFlag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    parts.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(centralHeaderSignature, 0);
    header.writeUInt16LE(versionNeeded, 4); // version made by
    header.writeUInt16LE(versionNeeded, 6); // version needed
    header.writeUInt16LE(utf8NameFlag, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    // extra field, comment, disk number, internal/external attributes: all 0
    header.writeUInt32LE(offset, 42); // where this entry's local header starts
    central.push(header, name);

    offset += local.length + name.length + body.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(endSignature, 0);
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16); // where the central directory starts
  return Buffer.concat([...parts, centralBytes, end]);
}
