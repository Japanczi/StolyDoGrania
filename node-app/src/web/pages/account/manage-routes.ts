// Profile pages (/Account/Manage/*): phone number, e-mail change, password change/set, personal data.
// All need a logged-in user. Ports of Components/Account/Pages/Manage/*.razor, ConfirmEmailChange.razor and
// the DownloadPersonalData endpoint.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashPassword, verifyPassword } from '../../../auth/password-hash.ts';
import { clearSessionCookie } from '../../../auth/request-auth.ts';
import { deleteUserSessions } from '../../../auth/sessions.ts';
import { consumeUserToken, createUserToken, deleteUserTokens } from '../../../db/queries/user-tokens.ts';
import { changeEmail, deleteUser, findUserById, setPasswordHash, setPhoneNumber, type User } from '../../../db/queries/users.ts';
import { normalizeKey } from '../../../domain/user-name.ts';
import { passwordStrengthErrors } from '../../../domain/password-policy.ts';
import { confirmAccountEmail, confirmEmailChangeEmail } from '../../../integrations/email/account-emails.ts';
import type { SafeHtml } from '../../html.ts';
import { addError, field, hasErrors, readForm, setFlash, takeFlash, type FieldErrors } from '../../forms.ts';
import { pathOf, requireUser, sendPage } from '../../respond.ts';
import type { AccountDeps } from './routes.ts';
import { checkEmail, checkNewPassword, checkRequired, errorLine } from './validation.ts';
import {
  changePasswordPage, deletePersonalDataPage, emailPage, manageLayout, personalDataPage, profilePage, setPasswordPage,
} from './manage-views.ts';
import { emptyForm, resultPage } from './views.ts';

type Query = Record<string, string | undefined>;

// Digits, spaces, "+", "-", ".", "()" – roughly what .NET's [Phone] attribute accepts.
const phonePattern = /^\+?[0-9 ().-]{3,30}$/;

export function manageRoutes(app: FastifyInstance, deps: AccountDeps): void {
  const { config, db, mailer } = deps;
  const strictPasswords = config.environment === 'production';
  const link = (path: string, params: Record<string, string>) =>
    `${config.publicUrl}${path}?${new URLSearchParams(params).toString()}`;

  /** Logged-in user's full row, or null after redirecting (to login, or home if the account vanished). */
  async function currentUser(request: FastifyRequest, reply: FastifyReply): Promise<User | null> {
    const sessionUser = requireUser(request, reply);
    if (!sessionUser) {
      return null;
    }
    const user = await findUserById(db, sessionUser.id);
    if (!user) {
      void reply.redirect('/', 302);
      return null;
    }
    return user;
  }

  const page = (request: FastifyRequest, reply: FastifyReply, title: string, body: SafeHtml) =>
    sendPage(request, reply, { title, body: manageLayout(pathOf(request.url), body) });

  /** After a successful POST: message on the next page, back to the same page (Post/Redirect/Get). */
  const done = (request: FastifyRequest, reply: FastifyReply, message: string) => {
    setFlash(reply, message);
    return reply.redirect(pathOf(request.url), 303);
  };

  // ---------- profile (phone number) ----------

  app.get('/Account/Manage', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return page(request, reply, 'Profil', profilePage(request, user, { ...emptyForm, message: takeFlash(request, reply) }));
  });

  app.post('/Account/Manage', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const phone = field(form, 'PhoneNumber').trim();
    if (phone !== '' && !phonePattern.test(phone)) {
      addError(errors, 'PhoneNumber', 'Podaj prawidłowy numer telefonu.');
      return page(request, reply, 'Profil', profilePage(request, user, { values: form, errors, message: null }));
    }
    await setPhoneNumber(db, user.id, phone === '' ? null : phone);
    return done(request, reply, 'Profil został zaktualizowany.');
  });

  // ---------- e-mail ----------

  app.get('/Account/Manage/Email', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return page(request, reply, 'Zarządzaj adresem e-mail', emailPage(request, user, { ...emptyForm, message: takeFlash(request, reply) }));
  });

  app.post('/Account/Manage/Email', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const newEmail = checkEmail(form, errors, 'NewEmail');
    const show = (message: string | null) =>
      page(request, reply, 'Zarządzaj adresem e-mail', emailPage(request, user, { values: form, errors, message }));
    if (hasErrors(errors)) {
      return show(null);
    }
    if (normalizeKey(newEmail) === user.normalized_email) {
      return show('Adres e-mail nie został zmieniony.');
    }
    // The link goes to the NEW address, so only its owner can confirm the change.
    const token = await createUserToken(db, user.id, 'change-email', newEmail);
    await mailer.send(confirmEmailChangeEmail(newEmail,
      link('/Account/ConfirmEmailChange', { userId: user.id, email: newEmail, code: token })));
    return show('Wysłaliśmy link potwierdzający zmianę adresu e-mail. Sprawdź swoją skrzynkę.');
  });

  app.post('/Account/Manage/SendVerificationEmail', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    const token = await createUserToken(db, user.id, 'confirm-email');
    await mailer.send(confirmAccountEmail(user.email, link('/Account/ConfirmEmail', { userId: user.id, code: token })));
    setFlash(reply, 'Wysłaliśmy e-mail weryfikacyjny. Sprawdź swoją skrzynkę.');
    return reply.redirect('/Account/Manage/Email', 303);
  });

  // Reached from the e-mail link; works without being logged in, like the .NET page.
  app.get('/Account/ConfirmEmailChange', async (request, reply) => {
    const { userId, email, code } = request.query as Query;
    const show = (message: string) =>
      sendPage(request, reply, { title: 'Potwierdź zmianę e-maila', body: resultPage('Potwierdź zmianę e-maila', message) });
    if (!userId || !email || !code) {
      setFlash(reply, 'Błąd: nieprawidłowy link potwierdzający zmianę e-maila.');
      return reply.redirect('/Account/Login', 302);
    }
    const user = await findUserById(db, userId);
    if (!user) {
      return show(`Błąd: nie znaleziono użytkownika o ID „${userId}”.`);
    }
    const used = await consumeUserToken(db, code, 'change-email', user.id);
    if (!used || used.newEmail === null || normalizeKey(used.newEmail) !== normalizeKey(email)
        || !(await changeEmail(db, user, used.newEmail))) {
      return show('Błąd: nie udało się zmienić adresu e-mail.');
    }
    return show('Dziękujemy za potwierdzenie zmiany adresu e-mail.');
  });

  // ---------- password ----------

  app.get('/Account/Manage/ChangePassword', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    if (user.password_hash === null) {
      return reply.redirect('/Account/Manage/SetPassword', 302);
    }
    return page(request, reply, 'Zmiana hasła', changePasswordPage(request, { ...emptyForm, message: takeFlash(request, reply) }));
  });

  app.post('/Account/Manage/ChangePassword', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    if (user.password_hash === null) {
      return reply.redirect('/Account/Manage/SetPassword', 303);
    }
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const oldPassword = checkRequired(form, errors, 'OldPassword', 'Podaj obecne hasło.');
    const newPassword = checkNewPassword(form, errors, 'NewPassword', 'ConfirmPassword', 'Podaj nowe hasło.');
    const show = (message: string | null) =>
      page(request, reply, 'Zmiana hasła', changePasswordPage(request, { values: {}, errors, message }));
    if (hasErrors(errors)) {
      return show(null);
    }
    if (!(await verifyPassword(user.password_hash, oldPassword)).ok) {
      return show(errorLine(['Nieprawidłowe hasło.']));
    }
    const weak = passwordStrengthErrors(newPassword, strictPasswords);
    if (weak.length > 0) {
      return show(errorLine(weak));
    }
    await setPasswordHash(db, user.id, await hashPassword(newPassword));
    // Other devices are logged out (this one stays logged in); old reset links stop working.
    await deleteUserSessions(db, user.id, request.sessionIdHash);
    await deleteUserTokens(db, user.id, 'reset-password');
    request.log.info('User changed their password successfully.');
    return done(request, reply, 'Hasło zostało zmienione.');
  });

  app.get('/Account/Manage/SetPassword', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    if (user.password_hash !== null) {
      return reply.redirect('/Account/Manage/ChangePassword', 302);
    }
    return page(request, reply, 'Ustaw hasło', setPasswordPage(request, { ...emptyForm, message: takeFlash(request, reply) }));
  });

  app.post('/Account/Manage/SetPassword', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    if (user.password_hash !== null) {
      return reply.redirect('/Account/Manage/ChangePassword', 303);
    }
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const newPassword = checkNewPassword(form, errors, 'NewPassword', 'ConfirmPassword', 'Podaj nowe hasło.');
    const show = (message: string | null) => page(request, reply, 'Ustaw hasło', setPasswordPage(request, { values: {}, errors, message }));
    if (hasErrors(errors)) {
      return show(null);
    }
    const weak = passwordStrengthErrors(newPassword, strictPasswords);
    if (weak.length > 0) {
      return show(errorLine(weak));
    }
    await setPasswordHash(db, user.id, await hashPassword(newPassword));
    setFlash(reply, 'Hasło zostało ustawione.');
    return reply.redirect('/Account/Manage/ChangePassword', 303);
  });

  // ---------- personal data ----------

  app.get('/Account/Manage/PersonalData', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return page(request, reply, 'Dane osobowe', personalDataPage(request, takeFlash(request, reply)));
  });

  // A POST (with the CSRF token) rather than a link, as in .NET, so another site can't trigger the download.
  app.post('/Account/Manage/DownloadPersonalData', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    request.log.info({ userId: user.id }, 'User asked for their personal data.');
    // Same keys and string values as the .NET download (Identity's [PersonalData] properties).
    const data = {
      Id: user.id,
      UserName: user.user_name,
      Email: user.email,
      EmailConfirmed: user.email_confirmed === 1 ? 'True' : 'False',
      PhoneNumber: user.phone_number ?? 'null',
    };
    return reply
      .header('Content-Disposition', 'attachment; filename=PersonalData.json')
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(data));
  });

  app.get('/Account/Manage/DeletePersonalData', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return page(request, reply, 'Usuń dane osobowe', deletePersonalDataPage(request, emptyForm, user.password_hash !== null));
  });

  app.post('/Account/Manage/DeletePersonalData', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    const requirePassword = user.password_hash !== null;
    const show = (message: string) =>
      page(request, reply, 'Usuń dane osobowe', deletePersonalDataPage(request, { values: {}, errors: {}, message }, requirePassword));

    // CLAUDE.md: nobody can delete the Owner – not even the Owner.
    if (user.role === 'owner') {
      return show('Błąd: konta głównego administratora (Owner) nie można usunąć.');
    }
    if (user.password_hash !== null && !(await verifyPassword(user.password_hash, field(readForm(request.body), 'Password'))).ok) {
      return show('Błąd: nieprawidłowe hasło.');
    }
    await deleteUser(db, user.id);
    clearSessionCookie(reply, config);
    request.log.info({ userId: user.id }, 'User deleted themselves.');
    return reply.redirect('/', 303);
  });
}
