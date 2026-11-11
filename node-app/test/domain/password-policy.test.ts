import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { passwordStrengthErrors } from '../../src/domain/password-policy.ts';

describe('passwordStrengthErrors (Identity rules)', () => {
  test('production: a strong password passes', () => {
    assert.deepEqual(passwordStrengthErrors('Gracz1!', true), []);
  });

  test('production: every broken rule is listed, in Identity order', () => {
    assert.deepEqual(passwordStrengthErrors('abc', true), [
      'Hasło musi mieć co najmniej 6 znaków.',
      'Hasło musi zawierać co najmniej jeden znak specjalny.',
      "Hasło musi zawierać co najmniej jedną cyfrę ('0'–'9').",
      "Hasło musi zawierać co najmniej jedną wielką literę ('A'–'Z').",
    ]);
  });

  test('a Polish letter counts as a special character (Identity only knows ASCII letters)', () => {
    assert.deepEqual(passwordStrengthErrors('Gracz1ą', true), []);
  });

  test('development: only a minimum length of 5', () => {
    assert.deepEqual(passwordStrengthErrors('gracz', false), []);
    assert.deepEqual(passwordStrengthErrors('abcd', false), ['Hasło musi mieć co najmniej 5 znaków.']);
  });
});
