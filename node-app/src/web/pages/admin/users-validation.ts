// Field checks for the admin "Dodaj użytkownika" form: the same rules as registration (Users.razor NewUserModel).

import { passwordLengthError, passwordMaxLength, passwordMinLength } from '../../../domain/password-policy.ts';
import { addError, field, type FieldErrors, type FormValues } from '../../forms.ts';

export { checkEmail, checkUserName } from '../account/validation.ts';

/** Required, 6–100 characters (no repeat field on this form). */
export function checkNewPasswordSimple(form: FormValues, errors: FieldErrors): string {
  const password = field(form, 'Password');
  if (password === '') {
    addError(errors, 'Password', 'Podaj hasło.');
  } else if (password.length < passwordMinLength || password.length > passwordMaxLength) {
    addError(errors, 'Password', passwordLengthError);
  }
  return password;
}
