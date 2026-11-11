// E-mail format rule. Port of Data/ValidEmailAttribute.cs.

export const emailFormatError = 'Podaj poprawny adres e-mail, np. jan.nowak@example.com.';

// Same pattern as the C# one. In JavaScript "$" (without the m flag) only matches at the very end,
// so the C# "\z" becomes "$" here.
const pattern = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+-]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/**
 * Stricter than a single-'@' check (so "a@b" fails): a local part of letters, digits and . _ % + - (no leading,
 * trailing or double dots), a domain of valid labels ending in a top-level domain of at least two letters,
 * max 254 characters. The caller trims surrounding spaces first.
 */
export function isValidEmail(value: string): boolean {
  return value.length > 0 && value.length <= 254 && pattern.test(value);
}
