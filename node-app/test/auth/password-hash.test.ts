import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPassword, scryptParams, verifyIdentityV3, verifyPassword } from '../../src/auth/password-hash.ts';

// Real hashes made by the .NET app (ASP.NET Identity v3: PBKDF2-HMAC-SHA512, 100 000 iterations) for two of the
// Development-only test users, whose password "gracz" is public (Data/IdentitySeeder.cs). Copied from a local app.db.
const janNowakHash = 'AQAAAAIAAYagAAAAEK5FkIRxq/2VBn//ycMkwExrRyuu131MiiuLbx/FXdqfDYjVRNXy1f2iCTMGPsrrwQ==';
const zofiaHash = 'AQAAAAIAAYagAAAAEK4wlH2ZenT1bGGWWR/Kiep75uSFtXRMQaLTJbwGz/Y4nP+YEZQjgKjmqPVJqaeE1A==';

describe('ASP.NET Identity v3 hashes', () => {
  test('the right password verifies, against two real hashes', async () => {
    assert.equal(await verifyIdentityV3(janNowakHash, 'gracz'), true);
    assert.equal(await verifyIdentityV3(zofiaHash, 'gracz'), true);
  });

  test('a wrong password fails', async () => {
    assert.equal(await verifyIdentityV3(janNowakHash, 'Gracz'), false);
    assert.equal(await verifyIdentityV3(janNowakHash, ''), false);
  });

  test('the header is read, not assumed: PRF 2 (SHA-512), 100 000 iterations, 16-byte salt', () => {
    const bytes = Buffer.from(janNowakHash, 'base64');
    assert.equal(bytes[0], 1);
    assert.equal(bytes.readUInt32BE(1), 2);
    assert.equal(bytes.readUInt32BE(5), 100_000);
    assert.equal(bytes.readUInt32BE(9), 16);
  });

  test('a changed header makes verification fail (so the values really are used)', async () => {
    const bytes = Buffer.from(janNowakHash, 'base64');
    bytes.writeUInt32BE(99_999, 5);
    assert.equal(await verifyIdentityV3(bytes.toString('base64'), 'gracz'), false);
  });

  test('malformed input fails without throwing', async () => {
    for (const bad of ['', 'not base64 at all', 'AQ==', Buffer.from([0, 1, 2, 3]).toString('base64')]) {
      assert.equal(await verifyIdentityV3(bad, 'gracz'), false, bad);
    }
  });

  test('verifyPassword asks for a rehash after a successful old-format check', async () => {
    assert.deepEqual(await verifyPassword(janNowakHash, 'gracz'), { ok: true, needsRehash: true });
    assert.deepEqual(await verifyPassword(janNowakHash, 'zle'), { ok: false, needsRehash: false });
  });
});

describe('scrypt hashes', () => {
  test('round trip: the right password verifies, a wrong one does not', async () => {
    const hash = await hashPassword('Tajne-hasło1');
    assert.match(hash, new RegExp(`^scrypt\\$${scryptParams.N}\\$${scryptParams.r}\\$${scryptParams.p}\\$`));
    assert.deepEqual(await verifyPassword(hash, 'Tajne-hasło1'), { ok: true, needsRehash: false });
    assert.deepEqual(await verifyPassword(hash, 'tajne-hasło1'), { ok: false, needsRehash: false });
  });

  test('the same password gets a different salt each time', async () => {
    assert.notEqual(await hashPassword('x'), await hashPassword('x'));
  });

  test('a hash with weaker parameters verifies and asks for a rehash', async () => {
    const hash = await hashPassword('abc');
    const [, , r, p, salt] = hash.split('$');
    // Recreate with N=2^10 by hand to simulate an older, cheaper setting.
    const { scryptSync } = await import('node:crypto');
    const key = scryptSync('abc', Buffer.from(salt ?? '', 'base64url'), 32, { N: 1024, r: Number(r), p: Number(p) });
    const weak = `scrypt$1024$${r}$${p}$${salt}$${key.toString('base64url')}`;
    assert.deepEqual(await verifyPassword(weak, 'abc'), { ok: true, needsRehash: true });
  });

  test('a broken scrypt hash fails without throwing', async () => {
    assert.deepEqual(await verifyPassword('scrypt$x$y', 'abc'), { ok: false, needsRehash: false });
  });
});
