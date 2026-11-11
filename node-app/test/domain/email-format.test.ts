// Port of Planszowkarz.Tests/ValidEmailAttributeTests.cs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { emailFormatError, isValidEmail } from '../../src/domain/email-format.ts';

describe('isValidEmail', () => {
  for (const email of ['jan.nowak@example.com', 'a_b%c+d-e@sub.example.co.uk', 'x@a1.pl', 'A@B-C.IO']) {
    test(`accepts ${email}`, () => assert.equal(isValidEmail(email), true));
  }

  for (const email of [
    'a@b', 'a@b.c', 'a@b.c1', '@example.com', 'jan@', 'a@@example.com', '.jan@example.com', 'jan.@example.com',
    'ja..n@example.com', 'jan@example..com', 'jan@-example.com', 'jan@example-.com', 'jan@.example.com',
    'jan@example.com.', 'jan nowak@example.com', ' jan@example.com', 'jan@example.com ', 'jan@exa mple.com',
    'jan@example.com\n', 'zażółć@example.com',
  ]) {
    test(`rejects ${JSON.stringify(email)}`, () => assert.equal(isValidEmail(email), false));
  }

  test('empty is rejected here (the forms say "Podaj adres e-mail." first)', () => {
    assert.equal(isValidEmail(''), false);
  });

  test('length limit is 254', () => {
    const domain = '@example.com';
    assert.equal(isValidEmail('a'.repeat(254 - domain.length) + domain), true);
    assert.equal(isValidEmail('a'.repeat(255 - domain.length) + domain), false);
  });

  test('domain label limit is 63', () => {
    assert.equal(isValidEmail(`a@${'b'.repeat(63)}.com`), true);
    assert.equal(isValidEmail(`a@${'b'.repeat(64)}.com`), false);
  });

  test('error message is Polish', () => {
    assert.equal(emailFormatError, 'Podaj poprawny adres e-mail, np. jan.nowak@example.com.');
  });
});
