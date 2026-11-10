// Password rules. In the .NET app these came from ASP.NET Identity's PasswordValidator (defaults in production,
// relaxed in Development, see Program.cs) plus [StringLength(100, MinimumLength = 6)] on the forms.
// Texts from Data/PolishIdentityErrorDescriber.cs.

export const passwordMinLength = 6;
export const passwordMaxLength = 100;

export const passwordLengthError = `Hasło musi mieć od ${passwordMinLength} do ${passwordMaxLength} znaków.`;
export const passwordsDifferError = 'Hasła nie są takie same.';

// Identity counts only ASCII letters and digits; anything else (also 'ą') is a "special character".
const isDigit = (c: string) => c >= '0' && c <= '9';
const isLower = (c: string) => c >= 'a' && c <= 'z';
const isUpper = (c: string) => c >= 'A' && c <= 'Z';

/**
 * Checks a new password against Identity's rules and returns the Polish messages for every rule broken,
 * in Identity's order. Production: at least 6 characters with a digit, a lower-case and an upper-case letter
 * and a special character. Elsewhere (development, tests) only the length counts, as in the .NET app.
 */
export function passwordStrengthErrors(password: string, strict: boolean): string[] {
  const errors: string[] = [];
  const chars = [...password];
  const minLength = strict ? 6 : 5;

  if (password.length < minLength) {
    errors.push(`Hasło musi mieć co najmniej ${minLength} znaków.`);
  }
  if (!strict) {
    return errors;
  }
  if (chars.every(c => isDigit(c) || isLower(c) || isUpper(c))) {
    errors.push('Hasło musi zawierać co najmniej jeden znak specjalny.');
  }
  if (!chars.some(isDigit)) {
    errors.push("Hasło musi zawierać co najmniej jedną cyfrę ('0'–'9').");
  }
  if (!chars.some(isLower)) {
    errors.push("Hasło musi zawierać co najmniej jedną małą literę ('a'–'z').");
  }
  if (!chars.some(isUpper)) {
    errors.push("Hasło musi zawierać co najmniej jedną wielką literę ('A'–'Z').");
  }
  return errors;
}
