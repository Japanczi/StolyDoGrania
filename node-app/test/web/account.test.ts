// Account pages through HTTP, with a cookie-keeping TestBrowser and a recording mailer.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { seedAccounts, testUserNames } from '../../src/auth/seed.ts';
import { findUserByEmail, findUserByUserName } from '../../src/db/queries/users.ts';
import { addUser, createTestApp, TestBrowser, testConfig } from '../helpers.ts';

const register = (b: TestBrowser, fields: Partial<Record<string, string>> = {}) =>
  b.post('/Account/Register', {
    UserName: 'Ola', Email: 'ola@example.com', Password: 'haslo1', ConfirmPassword: 'haslo1', ...fields,
  } as Record<string, string>);

describe('register → confirm → login', () => {
  test('the whole happy path', async t => {
    const { app, db, mailer, close } = await createTestApp();
    t.after(close);
    const b = new TestBrowser(app);

    const res = await register(b, { UserName: '  Ola   Kowalska ' });
    assert.equal(res.statusCode, 303);
    assert.match(res.headers.location ?? '', /^\/Account\/RegisterConfirmation\?userId=/);
    assert.doesNotMatch(res.headers.location ?? '', /example\.com/, 'no e-mail address in the URL');

    const user = await findUserByEmail(db, 'ola@example.com');
    assert.equal(user?.user_name, 'Ola Kowalska', 'stored normalised');
    assert.equal(user?.role, 'user');
    assert.equal(user?.email_confirmed, 0);

    const email = mailer.sent[0];
    assert.equal(email?.to, 'ola@example.com');
    assert.equal(email?.subject, 'Potwierdź adres e-mail');
    assert.match(email?.text ?? '', /^Hej, dzięki za założenie konta na Planszówkarzu :\)/);
    assert.match(email?.html ?? '', /Kliknij <a href="http:\/\/localhost\/Account\/ConfirmEmail\?userId=[^"]+&amp;code=/);

    const page = await b.get(res.headers.location ?? '');
    assert.match(page.body, /Sprawdź swoją skrzynkę e-mail, aby potwierdzić konto\./);

    assert.match((await b.login('Ola Kowalska', 'haslo1')).body, /najpierw potwierdź adres e-mail/);

    const confirm = await b.get(mailer.lastLink());
    assert.match(confirm.body, /Dziękujemy za potwierdzenie adresu e-mail\./);
    assert.match((await b.get(mailer.lastLink())).body, /Dziękujemy/, 'a second click (or a mail scanner first) is fine');

    const login = await b.login('ola@example.com', 'haslo1');
    assert.equal(login.statusCode, 303);
    assert.equal(login.headers.location, '/');
    const home = await b.get('/');
    assert.match(home.body, /title="Profil">Ola Kowalska</);
    assert.match(home.body, /Wyloguj/);
  });

  test('form errors are shown in Polish and nothing is created', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    const b = new TestBrowser(app);

    const res = await register(b, { UserName: 'x', Email: 'a@b', Password: '123', ConfirmPassword: '1234' });
    assert.equal(res.statusCode, 200);
    for (const message of [
      'Nazwa użytkownika: 3–20 znaków', 'Podaj poprawny adres e-mail', 'Hasło musi mieć od 6 do 100 znaków.', 'Hasła nie są takie same.',
    ]) {
      assert.ok(res.body.includes(message), message);
    }
    assert.match(res.body, /value="a@b"/, 'entered values stay in the form');
    assert.doesNotMatch(res.body, /value="123"/, 'passwords are never sent back');
    assert.equal(await findUserByEmail(db, 'a@b'), undefined);
  });

  test('a taken user name or e-mail is refused (case-insensitively)', async t => {
    const { app, close } = await createTestApp();
    t.after(close);
    const b = new TestBrowser(app);
    await register(b);

    assert.match((await register(b, { UserName: 'OLA', Email: 'inna@example.com' })).body, /Błąd: Ta nazwa użytkownika jest już zajęta\./);
    assert.match((await register(b, { UserName: 'Inna', Email: 'OLA@example.com' })).body, /Błąd: Ten adres e-mail jest już zarejestrowany\./);
  });

  test('production password rules apply in production', async t => {
    const { app, close } = await createTestApp({ environment: 'production' });
    t.after(close);
    const b = new TestBrowser(app);
    const res = await register(b, { Password: 'haslo1', ConfirmPassword: 'haslo1' });
    // "haslo1" has a digit and lower-case letters, but no special character and no upper-case letter.
    assert.match(res.body, /Błąd: Hasło musi zawierać co najmniej jeden znak specjalny\., Hasło musi zawierać co najmniej jedną wielką literę/);
  });

  test('without an e-mail server the confirm link is shown on the page', async t => {
    const { app, close } = await createTestApp({}, Object.assign(new (await import('../helpers.ts')).RecordingMailer(), { sendsEmail: false }));
    t.after(close);
    const b = new TestBrowser(app);
    const res = await register(b);
    const page = await b.get(res.headers.location ?? '');
    const href = /href="http:\/\/localhost(\/Account\/ConfirmEmail[^"]+)"/.exec(page.body)?.[1];
    assert.ok(href, 'link shown');
    assert.match((await b.get(href.replaceAll('&amp;', '&'))).body, /Dziękujemy za potwierdzenie/);
  });
});

describe('login', () => {
  test('wrong password: generic Polish error; ReturnUrl is followed only to our own pages', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);

    assert.match((await b.login('Jan Nowak', 'zle')).body, /Błąd: nieprawidłowy login lub hasło\./);

    const ok = await b.post('/Account/Login?ReturnUrl=%2FAccount%2FManage', { Email: 'Jan Nowak', Password: 'haslo1' });
    assert.equal(ok.headers.location, '/Account/Manage');

    for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await new TestBrowser(app).post(`/Account/Login?ReturnUrl=${encodeURIComponent(evil)}`, { Email: 'Jan Nowak', Password: 'haslo1' });
      assert.ok(!/^(https?:)?\/\/|^\/\\/.test(res.headers.location ?? ''), `${evil} → ${res.headers.location}`);
    }
  });

  test('lockout after 5 failures redirects to the lockout page', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);
    for (let i = 0; i < 4; i++) {
      await b.login('Jan Nowak', 'zle');
    }
    const res = await b.login('Jan Nowak', 'zle');
    assert.equal(res.headers.location, '/Account/Lockout');
    assert.match((await b.get('/Account/Lockout')).body, /Konto zablokowane/);
  });

  test('"Zapamiętaj mnie" makes the cookie persistent; otherwise it ends with the browser', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');

    const plain = await new TestBrowser(app).login('Jan Nowak', 'haslo1');
    const remembered = await new TestBrowser(app).post('/Account/Login', { Email: 'Jan Nowak', Password: 'haslo1', RememberMe: 'true' });
    const sessionCookie = (res: typeof plain) => (res.cookies as { name: string; maxAge?: number; httpOnly?: boolean; sameSite?: string }[]).find(c => c.name === 'session');
    assert.equal(sessionCookie(plain)?.maxAge, undefined);
    assert.equal(sessionCookie(remembered)?.maxAge, 14 * 24 * 60 * 60);
    assert.equal(sessionCookie(plain)?.httpOnly, true);
    assert.equal(sessionCookie(plain)?.sameSite, 'Lax');
  });

  test('production cookies use the __Host- prefix and Secure', async t => {
    const { app, db, close } = await createTestApp({ environment: 'production' });
    t.after(close);
    await addUser(db, 'Jan Nowak', 'Haslo1!');
    const first = await app.inject({ method: 'GET', url: '/' });
    const csrf = (first.cookies as { name: string; value: string; secure?: boolean }[]).find(c => c.name === '__Host-csrf');
    assert.equal(csrf?.secure, true);
  });

  test('logout ends the session on the server too', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');
    const stolen = b.cookies.get('session');

    const res = await b.post('/Account/Logout', { ReturnUrl: '/stoly' });
    assert.equal(res.headers.location, '/stoly');
    assert.equal(b.cookies.has('session'), false);
    assert.equal((await db.selectFrom('sessions').selectAll().execute()).length, 0);

    const replay = await app.inject({ method: 'GET', url: '/Account/Manage', headers: { cookie: `session=${stolen}` } });
    assert.equal(replay.statusCode, 302, 'an old cookie no longer works');
  });
});

describe('CSRF', () => {
  test('a form without the token is refused, and nothing happens', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    const b = new TestBrowser(app);
    const res = await b.post('/Account/Register', { UserName: 'Ola', Email: 'ola@example.com', Password: 'haslo1', ConfirmPassword: 'haslo1' }, { csrf: null });
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /formularz wygasł/);
    assert.equal(await findUserByUserName(db, 'Ola'), undefined);
  });

  test('a post from another site is refused even with a valid token', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');

    const crossSite = await b.post('/Account/Logout', { ReturnUrl: '/' }, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.statusCode, 403);
    const foreignOrigin = await b.post('/Account/Logout', { ReturnUrl: '/' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreignOrigin.statusCode, 403);
    assert.equal((await db.selectFrom('sessions').selectAll().execute()).length, 1, 'still logged in');
  });

  test('every page with a form carries the token', async t => {
    const { app, close } = await createTestApp();
    t.after(close);
    const b = new TestBrowser(app);
    const page = await b.get('/Account/Login');
    assert.ok(page.body.includes(`name="_csrf" value="${b.cookies.get('csrf')}"`));
  });
});

describe('forgot / reset password', () => {
  test('reset by e-mail link logs out everywhere and the link works once', async t => {
    const { app, db, mailer, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'stare1', { email: 'jan@example.com' });
    const other = new TestBrowser(app);
    await other.login('Jan Nowak', 'stare1');

    const b = new TestBrowser(app);
    const forgot = await b.post('/Account/ForgotPassword', { Email: 'jan@example.com' });
    assert.equal(forgot.headers.location, '/Account/ForgotPasswordConfirmation');
    assert.equal(mailer.sent.at(-1)?.subject, 'Resetowanie hasła');

    const link = mailer.lastLink();
    const code = new URL(link, 'http://localhost').searchParams.get('code') ?? '';
    assert.match((await b.get(link)).body, /Ustaw nowe hasło\./);

    const reset = await b.post('/Account/ResetPassword', { Email: 'jan@example.com', Password: 'nowe12', ConfirmPassword: 'nowe12', Code: code });
    assert.equal(reset.headers.location, '/Account/ResetPasswordConfirmation');
    assert.equal((await b.login('Jan Nowak', 'nowe12')).statusCode, 303);
    assert.equal((await other.get('/Account/Manage')).statusCode, 302, 'the other device was logged out');

    const again = await b.post('/Account/ResetPassword', { Email: 'jan@example.com', Password: 'inne12', ConfirmPassword: 'inne12', Code: code });
    assert.match(again.body, /Błąd: Link lub kod jest nieprawidłowy albo wygasł\./);
  });

  test('unknown addresses get the same answer and no e-mail', async t => {
    const { app, mailer, close } = await createTestApp();
    t.after(close);
    const res = await new TestBrowser(app).post('/Account/ForgotPassword', { Email: 'nikt@example.com' });
    assert.equal(res.headers.location, '/Account/ForgotPasswordConfirmation');
    assert.equal(mailer.sent.length, 0);
  });

  test('without a code the reset page sends you to the "invalid" page', async t => {
    const { app, close } = await createTestApp();
    t.after(close);
    assert.equal((await new TestBrowser(app).get('/Account/ResetPassword')).headers.location, '/Account/InvalidPasswordReset');
  });
});

describe('profile pages', () => {
  test('need a login, then come back', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);
    const res = await b.get('/Account/Manage/Email');
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/Account/Login?ReturnUrl=%2FAccount%2FManage%2FEmail');
  });

  test('phone number is saved with a status message; URLs are case-insensitive like in .NET', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');

    assert.match((await b.post('/Account/Manage', { PhoneNumber: 'abc' })).body, /Podaj prawidłowy numer telefonu\./);
    const res = await b.post('/Account/Manage', { PhoneNumber: '+48 600 100 200' });
    assert.equal(res.headers.location, '/Account/Manage');
    const page = await b.get('/account/manage');
    assert.match(page.body, /Profil został zaktualizowany\./);
    assert.match(page.body, /value="\+48 600 100 200"/);
    assert.doesNotMatch((await b.get('/Account/Manage')).body, /Profil został zaktualizowany/, 'the message shows once');
  });

  test('change password: wrong old password refused; success keeps this session, ends the others', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'stare1');
    const b = new TestBrowser(app);
    const other = new TestBrowser(app);
    await b.login('Jan Nowak', 'stare1');
    await other.login('Jan Nowak', 'stare1');

    const wrong = await b.post('/Account/Manage/ChangePassword', { OldPassword: 'zle', NewPassword: 'nowe12', ConfirmPassword: 'nowe12' });
    assert.match(wrong.body, /Błąd: Nieprawidłowe hasło\./);

    const ok = await b.post('/Account/Manage/ChangePassword', { OldPassword: 'stare1', NewPassword: 'nowe12', ConfirmPassword: 'nowe12' });
    assert.equal(ok.statusCode, 303);
    assert.match((await b.get('/Account/Manage/ChangePassword')).body, /Hasło zostało zmienione\./);
    assert.equal((await other.get('/Account/Manage')).statusCode, 302);
  });

  test('e-mail change is confirmed by a link sent to the new address', async t => {
    const { app, db, mailer, close } = await createTestApp();
    t.after(close);
    const user = await addUser(db, 'Jan Nowak', 'haslo1', { email: 'jan@example.com' });
    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');

    assert.match((await b.post('/Account/Manage/Email', { NewEmail: 'JAN@example.com' })).body, /Adres e-mail nie został zmieniony\./);
    const res = await b.post('/Account/Manage/Email', { NewEmail: 'nowy@example.com' });
    assert.match(res.body, /Wysłaliśmy link potwierdzający zmianę adresu e-mail/);
    assert.equal(mailer.sent.at(-1)?.to, 'nowy@example.com');
    assert.match(mailer.sent.at(-1)?.text ?? '', /^Hej, potwierdź nowy adres e-mail/);
    assert.equal((await findUserByEmail(db, 'jan@example.com'))?.id, user.id, 'unchanged until confirmed');

    assert.match((await b.get(mailer.lastLink())).body, /Dziękujemy za potwierdzenie zmiany adresu e-mail\./);
    assert.equal((await findUserByEmail(db, 'nowy@example.com'))?.user_name, 'Jan Nowak', 'user name unchanged');
  });

  test('an old account whose user name is its e-mail keeps both in sync', async t => {
    const { app, db, mailer, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'stary@example.com', 'haslo1', { email: 'stary@example.com' });
    const b = new TestBrowser(app);
    await b.login('stary@example.com', 'haslo1');
    await b.post('/Account/Manage/Email', { NewEmail: 'nowy@example.com' });
    await b.get(mailer.lastLink());
    assert.equal((await findUserByEmail(db, 'nowy@example.com'))?.user_name, 'nowy@example.com');
  });

  test('personal data download is JSON with the account fields', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    const user = await addUser(db, 'Jan Nowak', 'haslo1', { email: 'jan@example.com' });
    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');
    const res = await b.post('/Account/Manage/DownloadPersonalData', {});
    assert.match(res.headers['content-disposition'] as string, /attachment; filename=PersonalData\.json/);
    assert.deepEqual(res.json(), { Id: user.id, UserName: 'Jan Nowak', Email: 'jan@example.com', EmailConfirmed: 'True', PhoneNumber: 'null' });
  });

  test('deleting the account needs the password; the Owner cannot delete theirs', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Jan Nowak', 'haslo1');
    await addUser(db, 'Szef', 'haslo1', { role: 'owner' });

    const b = new TestBrowser(app);
    await b.login('Jan Nowak', 'haslo1');
    assert.match((await b.post('/Account/Manage/DeletePersonalData', { Password: 'zle' })).body, /Błąd: nieprawidłowe hasło\./);
    assert.equal((await b.post('/Account/Manage/DeletePersonalData', { Password: 'haslo1' })).headers.location, '/');
    assert.equal(await findUserByUserName(db, 'Jan Nowak'), undefined);
    assert.equal(b.cookies.has('session'), false);

    const owner = new TestBrowser(app);
    await owner.login('Szef', 'haslo1');
    assert.match((await owner.post('/Account/Manage/DeletePersonalData', { Password: 'haslo1' })).body, /nie można usunąć/);
    assert.notEqual(await findUserByUserName(db, 'Szef'), undefined);
  });

  test('admins see the admin menu entries; regular users do not', async t => {
    const { app, db, close } = await createTestApp();
    t.after(close);
    await addUser(db, 'Admin', 'haslo1', { role: 'admin' });
    await addUser(db, 'Gracz', 'haslo1');
    const admin = new TestBrowser(app);
    await admin.login('Admin', 'haslo1');
    const player = new TestBrowser(app);
    await player.login('Gracz', 'haslo1');
    assert.match((await admin.get('/')).body, /Użytkownicy/);
    assert.doesNotMatch((await player.get('/')).body, /Użytkownicy/);
  });
});

describe('seeding', () => {
  const log = { warn() {}, error() {}, info() {} } as unknown as Parameters<typeof seedAccounts>[2];

  test('creates the Owner from config, and test users only in development', async t => {
    const { db, close } = await createTestApp();
    t.after(close);
    const config = { ...testConfig, adminSeed: { userName: 'Szef', email: 'szef@example.com', password: 'tajne1' } };

    await seedAccounts(db, config, log);
    assert.equal((await findUserByUserName(db, 'Szef'))?.role, 'owner');
    assert.equal(await findUserByUserName(db, testUserNames[0]), undefined, 'no test users outside development');

    await seedAccounts(db, { ...config, environment: 'development' }, log);
    for (const name of testUserNames) {
      assert.equal((await findUserByUserName(db, name))?.email_confirmed, 1, name);
    }
    await seedAccounts(db, { ...config, environment: 'development' }, log);
    assert.equal((await db.selectFrom('users').select('id').execute()).length, 5, 'running twice adds nothing');
  });
});
