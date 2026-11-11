// Field checks shared by the account forms – the [Required], [StringLength], [Compare], [ValidEmail] and
// [ValidUserName] attributes of the Razor pages' InputModel classes.

import { isValidEmail, emailFormatError } from '../../../domain/email-format.ts';
import { passwordLengthError, passwordMaxLength, passwordMinLength, passwordsDifferError } from '../../../domain/password-policy.ts';
import { isValidUserName, userNameError } from '../../../domain/user-name.ts';
import { addError, field, type FieldErrors, type FormValues } from '../../forms.ts';

/** Required + our e-mail format. Returns the trimmed address. */
export function checkEmail(form: FormValues, errors: FieldErrors, name = 'Email', requiredMessage = 'Podaj adres e-mail.'): string {
  const email = field(form, name).trim();
  if (email === '') {
    addError(errors, name, requiredMessage);
  } else if (!isValidEmail(email)) {
    addError(errors, name, emailFormatError);
  }
  return email;
}

/** Required + user-name rules. Returns the value as given (normalise before storing). */
export function checkUserName(form: FormValues, errors: FieldErrors): string {
  const userName = field(form, 'UserName');
  if (userName.trim() === '') {
    addError(errors, 'UserName', 'Podaj nazwę użytkownika.');
  } else if (!isValidUserName(userName)) {
    addError(errors, 'UserName', userNameError);
  }
  return userName;
}

/** Required, 6–100 characters, and the repeat must match. Returns the password. */
export function checkNewPassword(
  form: FormValues, errors: FieldErrors, name: string, confirmName: string, requiredMessage: string,
): string {
  const password = field(form, name);
  if (password === '') {
    addError(errors, name, requiredMessage);
  } else if (password.length < passwordMinLength || password.length > passwordMaxLength) {
    addError(errors, name, passwordLengthError);
  }
  if (field(form, confirmName) !== password) {
    addError(errors, confirmName, passwordsDifferError);
  }
  return password;
}

export function checkRequired(form: FormValues, errors: FieldErrors, name: string, message: string): string {
  const value = field(form, name);
  if (value === '') {
    addError(errors, name, message);
  }
  return value;
}

/** Identity-style list of problems as one status line: "Błąd: a, b". */
export function errorLine(problems: string[]): string {
  return `Błąd: ${problems.join(', ')}`;
}
