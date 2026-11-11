import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';

/** Reads the zip back through its central directory (independent of how createZip laid things out). */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory present');
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(pos), 0x02014b50);
    const method = zip.readUInt16LE(pos + 10);
    const checksum = zip.readUInt32LE(pos + 16);
    const compressed = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24);
    const nameLength = zip.readUInt16LE(pos + 28);
    const offset = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(data.length, size);
    assert.equal(crc32(data), checksum);
    files.set(name, Buffer.from(data));
    pos += 46 + nameLength;
  }
  return files;
}
