// Public account pages: register, confirm e-mail, login, logout, lockout, forgot/reset password.
// Ports of Components/Account/Pages/*.razor and the Logout endpoint. Each form page has a GET (show the form)
// and a POST (check, then re-show with errors or redirect: Post/Redirect/Get).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkLogin } from '../../../auth/login-flow.ts';
import { hashPassword } from '../../../auth/password-hash.ts';
import { clearSessionCookie, setSessionCookie } from '../../../auth/request-auth.ts';
import { createSession, deleteSession, deleteUserSessions } from '../../../auth/sessions.ts';
import type { Config } from '../../../config.ts';
import type { Db } from '../../../db/database.ts';
import { consumeUserToken, createUserToken, deleteUserTokens } from '../../../db/queries/user-tokens.ts';
import { confirmEmail, createUser, findUserByEmail, findUserById, setPasswordHash } from '../../../db/queries/users.ts';
import { passwordStrengthErrors } from '../../../domain/password-policy.ts';
import { normalizeUserName } from '../../../domain/user-name.ts';
import { confirmAccountEmail, resetPasswordEmail } from '../../../integrations/email/account-emails.ts';
import type { Mailer } from '../../../integrations/email/mailer.ts';
import { field, hasErrors, readForm, safeReturnUrl, takeFlash, type FieldErrors } from '../../forms.ts';
import { sendPage } from '../../respond.ts';
import { checkEmail, checkNewPassword, checkRequired, checkUserName, errorLine } from './validation.ts';
import {
  emailOnlyPage, emptyForm, infoPages, loginPage, registerConfirmationPage, registerPage, resetPasswordPage, resultPage,
} from './views.ts';

export type AccountDeps = { config: Config; db: Db; mailer: Mailer };

type Query = Record<string, string | undefined>;

export function accountRoutes(app: FastifyInstance, deps: AccountDeps): void {
  const { config, db, mailer } = deps;
  const strictPasswords = config.environment === 'production';
  const link = (path: string, params: Record<string, string>) =>
    `${config.publicUrl}${path}?${new URLSearchParams(params).toString()}`;

  // ---------- register ----------

  app.get('/Account/Register', async (request, reply) =>
    sendPage(request, reply, { title: 'Rejestracja', body: registerPage(request, emptyForm) }));

  app.post('/Account/Register', async (request, reply) => {
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const userName = checkUserName(form, errors);
    const email = checkEmail(form, errors);
    const password = checkNewPassword(form, errors, 'Password', 'ConfirmPassword', 'Podaj hasło.');
    const show = (message: string | null) =>
      sendPage(request, reply, { title: 'Rejestracja', body: registerPage(request, { values: form, errors, message }) });

    if (hasErrors(errors)) {
      return show(null);
    }
    const weak = passwordStrengthErrors(password, strictPasswords);
    if (weak.length > 0) {
      return show(errorLine(weak));
    }

    const created = await createUser(db, {
      userName: normalizeUserName(userName),
      email,
      passwordHash: await hashPassword(password),
      emailConfirmed: false,
      role: 'user',
    });
    if (!created.ok) {
      return show(errorLine([created.taken === 'email' ? 'Ten adres e-mail jest już zarejestrowany.' : 'Ta nazwa użytkownika jest już zajęta.']));
    }

    request.log.info('User created a new account with password.');
    const token = await createUserToken(db, created.user.id, 'confirm-email');
    await mailer.send(confirmAccountEmail(email, link('/Account/ConfirmEmail', { userId: created.user.id, code: token })));
    // The user id, not the e-mail, goes into the URL: addresses don't belong in URLs (they end up in logs).
    return reply.redirect(`/Account/RegisterConfirmation?userId=${encodeURIComponent(created.user.id)}`, 303);
  });

  app.get('/Account/RegisterConfirmation', async (request, reply) => {
    const { userId } = request.query as Query;
    if (!userId) {
      return reply.redirect('/', 302);
    }
    const user = await findUserById(db, userId);
    if (!user) {
      return sendPage(request, reply, {
        title: 'Potwierdzenie rejestracji',
        body: registerConfirmationPage('Błąd: nie znaleziono użytkownika.', null),
      }, 404);
    }
    // Without an e-mail server (local development) the link is shown here instead, as in the .NET app.
    let confirmLink: string | null = null;
    if (!mailer.sendsEmail && user.email_confirmed !== 1) {
      const token = await createUserToken(db, user.id, 'confirm-email');
      confirmLink = link('/Account/ConfirmEmail', { userId: user.id, code: token });
    }
    return sendPage(request, reply, { title: 'Potwierdzenie rejestracji', body: registerConfirmationPage(null, confirmLink) });
  });

  app.get('/Account/ConfirmEmail', async (request, reply) => {
    const { userId, code } = request.query as Query;
    if (!userId || !code) {
      return reply.redirect('/', 302);
    }
    const page = (message: string, status = 200) =>
      sendPage(request, reply, { title: 'Potwierdź e-mail', body: resultPage('Potwierdź e-mail', message) }, status);

    const user = await findUserById(db, userId);
    if (!user) {
      return page(`Błąd: nie udało się wczytać użytkownika o ID ${userId}.`, 404);
    }
    const used = await consumeUserToken(db, code, 'confirm-email', user.id);
    // A mail scanner may have opened the link first and used the token: the address is confirmed all the same.
    if (used || user.email_confirmed === 1) {
      await confirmEmail(db, user.id);
      return page('Dziękujemy za potwierdzenie adresu e-mail.');
    }
    return page('Błąd: nie udało się potwierdzić adresu e-mail.');
  });

  app.get('/Account/ResendEmailConfirmation', async (request, reply) =>
    sendPage(request, reply, { title: 'Wyślij ponownie potwierdzenie e-maila', body: resendPage(request, emptyForm) }));

  app.post('/Account/ResendEmailConfirmation', async (request, reply) => {
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const email = checkEmail(form, errors, 'Email');
    if (!hasErrors(errors)) {
      const user = await findUserByEmail(db, email);
      if (user && user.email_confirmed !== 1) {
        const token = await createUserToken(db, user.id, 'confirm-email');
        await mailer.send(confirmAccountEmail(user.email, link('/Account/ConfirmEmail', { userId: user.id, code: token })));
      }
    }
    // Same answer whether or not the address exists, so this form can't be used to probe for accounts.
    const message = hasErrors(errors) ? null : 'Wysłaliśmy e-mail weryfikacyjny. Sprawdź swoją skrzynkę e-mail.';
    return sendPage(request, reply, {
      title: 'Wyślij ponownie potwierdzenie e-maila',
      body: resendPage(request, { values: form, errors, message }),
    });
  });

  // ---------- login / logout ----------

  app.get('/Account/Login', async (request, reply) => {
    const { ReturnUrl } = request.query as Query;
    return sendPage(request, reply, {
      title: 'Logowanie',
      body: loginPage(request, { ...emptyForm, message: takeFlash(request, reply) }, ReturnUrl),
    });
  });

  app.post('/Account/Login', async (request, reply) => {
    const { ReturnUrl } = request.query as Query;
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const login = checkRequired(form, errors, 'Email', 'Podaj e-mail lub nazwę użytkownika.');
    const password = checkRequired(form, errors, 'Password', 'Podaj hasło.');
    const show = (message: string | null) =>
      sendPage(request, reply, { title: 'Logowanie', body: loginPage(request, { values: form, errors, message }, ReturnUrl) });

    if (hasErrors(errors)) {
      return show(null);
    }

    const result = await checkLogin(db, login, password);
    switch (result.kind) {
      case 'invalid':
        return show('Błąd: nieprawidłowy login lub hasło.');
      case 'locked-out':
        request.log.warn('User account locked out.');
        return reply.redirect('/Account/Lockout', 303);
      case 'email-not-confirmed':
        return show('Błąd: najpierw potwierdź adres e-mail – link jest w wiadomości od nas.');
      case 'success': {
        // A new session id on every login, so an id planted before login is useless ("session fixation").
        const persistent = field(form, 'RememberMe') === 'true';
        const session = await createSession(db, result.user.id, { persistent, authLevel: 'full' });
        setSessionCookie(reply, config, session.id, persistent);
        request.log.info('User logged in.');
        return reply.redirect(safeReturnUrl(ReturnUrl), 303);
      }
    }
  });

  app.post('/Account/Logout', async (request, reply) => {
    if (request.sessionIdHash) {
      await deleteSession(db, request.sessionIdHash);
    }
    clearSessionCookie(reply, config);
    return reply.redirect(safeReturnUrl(field(readForm(request.body), 'ReturnUrl')), 303);
  });

  // ---------- forgot / reset password ----------

  app.get('/Account/ForgotPassword', async (request, reply) =>
    sendPage(request, reply, { title: 'Nie pamiętasz hasła?', body: forgotPage(request, emptyForm) }));

  app.post('/Account/ForgotPassword', async (request, reply) => {
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const email = checkEmail(form, errors, 'Email');
    if (hasErrors(errors)) {
      return sendPage(request, reply, { title: 'Nie pamiętasz hasła?', body: forgotPage(request, { values: form, errors, message: null }) });
    }
    const user = await findUserByEmail(db, email);
    // Don't reveal whether the user exists or is confirmed: the next page is the same either way.
    if (user && user.email_confirmed === 1) {
      const token = await createUserToken(db, user.id, 'reset-password');
      await mailer.send(resetPasswordEmail(user.email, link('/Account/ResetPassword', { code: token })));
    }
    return reply.redirect('/Account/ForgotPasswordConfirmation', 303);
  });

  app.get('/Account/ResetPassword', async (request, reply) => {
    const { code } = request.query as Query;
    if (!code) {
      return reply.redirect('/Account/InvalidPasswordReset', 302);
    }
    return sendPage(request, reply, { title: 'Resetowanie hasła', body: resetPasswordPage(request, emptyForm, code) });
  });

  app.post('/Account/ResetPassword', async (request, reply) => {
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const email = checkEmail(form, errors, 'Email');
    const password = checkNewPassword(form, errors, 'Password', 'ConfirmPassword', 'Podaj hasło.');
    const code = checkRequired(form, errors, 'Code', 'Brak kodu resetowania hasła.');
    const show = (message: string | null) =>
      sendPage(request, reply, { title: 'Resetowanie hasła', body: resetPasswordPage(request, { values: form, errors, message }, code) });

    if (hasErrors(errors)) {
      return show(null);
    }
    const user = await findUserByEmail(db, email);
    if (!user) {
      // Don't reveal that the user does not exist.
      return reply.redirect('/Account/ResetPasswordConfirmation', 303);
    }
    const weak = passwordStrengthErrors(password, strictPasswords);
    if (weak.length > 0) {
      return show(errorLine(weak));
    }
    if (!(await consumeUserToken(db, code, 'reset-password', user.id))) {
      return show(errorLine(['Link lub kod jest nieprawidłowy albo wygasł.']));
    }
    await setPasswordHash(db, user.id, await hashPassword(password));
    // Whoever knew the old password is logged out everywhere; other reset links stop working.
    await deleteUserSessions(db, user.id);
    await deleteUserTokens(db, user.id, 'reset-password');
    return reply.redirect('/Account/ResetPasswordConfirmation', 303);
  });

  // ---------- fixed-text pages ----------

  const info = (path: string, page: { title: string; body: ReturnType<typeof resultPage> }) =>
    app.get(path, async (request: FastifyRequest, reply: FastifyReply) => sendPage(request, reply, page));
  info('/Account/ForgotPasswordConfirmation', infoPages.forgotPasswordConfirmation);
  info('/Account/ResetPasswordConfirmation', infoPages.resetPasswordConfirmation);
  info('/Account/InvalidPasswordReset', infoPages.invalidPasswordReset);
  info('/Account/Lockout', infoPages.lockout);
  info('/Account/AccessDenied', infoPages.accessDenied);
}

function resendPage(request: FastifyRequest, s: Parameters<typeof emailOnlyPage>[1]) {
  return emailOnlyPage(request, s, { heading: 'Wyślij ponownie potwierdzenie e-maila', button: 'Wyślij ponownie' });
}

function forgotPage(request: FastifyRequest, s: Parameters<typeof emailOnlyPage>[1]) {
  return emailOnlyPage(request, s, { heading: 'Nie pamiętasz hasła?', button: 'Zresetuj hasło' });
}

