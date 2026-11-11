// User name rules. Port of Data/ValidUserNameAttribute.cs and Components/Layout/UserNames.cs.

export const userNameError = 'Nazwa użytkownika: 3–20 znaków – litery, cyfry, spacje, „.”, „_” lub „-”.';

const allowed = /^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_.\- ]{3,20}$/;

/** Trims and collapses runs of spaces, so "Jan  Nowak" and "Jan Nowak" can't both exist. */
export function normalizeUserName(value: string): string {
  return value.split(' ').filter(part => part !== '').join(' ');
}

/**
 * Checks a user name as it will be stored (after normalizeUserName): 3–20 characters of letters (incl. Polish),
 * digits, spaces, '.', '_' or '-'. No '@', so a user name can never be mistaken for an e-mail address at login.
 */
export function isValidUserName(value: string): boolean {
  return allowed.test(normalizeUserName(value));
}

/** Key for case-insensitive comparison and uniqueness (Identity's NormalizedUserName / NormalizedEmail). */
export function normalizeKey(value: string): string {
  return value.toUpperCase();
}

/** Part of a name before '@': a full e-mail address is never displayed (older accounts used it as user name). */
export function shortName(name: string): string {
  const at = name.indexOf('@');
  return at > 0 ? name.slice(0, at) : name;
}
