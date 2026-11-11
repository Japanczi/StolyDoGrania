import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isValidUserName, normalizeKey, normalizeUserName, shortName } from '../../src/domain/user-name.ts';

describe('user names', () => {
  test('normalising trims and collapses spaces', () => {
    assert.equal(normalizeUserName('  Jan   Nowak '), 'Jan Nowak');
  });

  for (const name of ['Jan', 'Jan Nowak', 'zażółć_gęślą', 'a.b-c_d 1', 'x'.repeat(20), '  Ola  ']) {
    test(`accepts ${JSON.stringify(name)}`, () => assert.equal(isValidUserName(name), true));
  }

  for (const name of ['ab', 'x'.repeat(21), 'jan@example.com', 'Jan!', 'Ж ля', '', '   ']) {
    test(`rejects ${JSON.stringify(name)}`, () => assert.equal(isValidUserName(name), false));
  }

  test('length is checked after normalising ("a  b" is 3 characters)', () => {
    assert.equal(isValidUserName('a     b'), true);
  });

  test('keys are case-insensitive, Polish letters included', () => {
    assert.equal(normalizeKey('Żaneta'), normalizeKey('żANETA'));
  });

  test('shortName never shows a full e-mail address', () => {
    assert.equal(shortName('jan.nowak@example.com'), 'jan.nowak');
    assert.equal(shortName('Jan Nowak'), 'Jan Nowak');
    assert.equal(shortName('@x'), '@x');
  });
});
