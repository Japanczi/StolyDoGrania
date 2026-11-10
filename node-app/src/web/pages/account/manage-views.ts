// Templates of the profile pages (/Account/Manage/*). Ports of Components/Account/Pages/Manage/*.razor and
// Shared/ManageLayout + ManageNavMenu. The 2FA, passkey and external-login entries are left out (not in v1).

import type { FastifyRequest } from 'fastify';
import type { User } from '../../../db/queries/users.ts';
import { html, type SafeHtml } from '../../html.ts';
import { csrfField, floatingInput, statusMessage, validationSummary } from '../../forms.ts';
import type { FormState } from './views.ts';

const navItems = [
  ['/Account/Manage', 'Profil'],
  ['/Account/Manage/Email', 'E-mail'],
  ['/Account/Manage/ChangePassword', 'Hasło'],
  ['/Account/Manage/PersonalData', 'Dane osobowe'],
] as const;

/** ManageLayout: heading, the menu on the left, the page on the right. */
export function manageLayout(currentPath: string, body: SafeHtml): SafeHtml {
  const active = (href: string) =>
    href === currentPath || (href === '/Account/Manage/ChangePassword' && currentPath === '/Account/Manage/SetPassword')
    || (href === '/Account/Manage/PersonalData' && currentPath === '/Account/Manage/DeletePersonalData');
  return html`<h1>Zarządzaj kontem</h1>
<div>
    <h2>Zmień ustawienia konta</h2>
    <hr />
    <div class="row">
        <div class="col-lg-3">
            <ul class="nav nav-pills flex-column">
                ${navItems.map(([href, label]) => html`<li class="nav-item"><a class="nav-link${active(href) ? ' active' : ''}" href="${href}"${active(href) ? html` aria-current="page"` : ''}>${label}</a></li>`)}
            </ul>
        </div>
        <div class="col-lg-9">
            ${body}
        </div>
    </div>
</div>`;
}

export function profilePage(request: FastifyRequest, user: User, s: FormState): SafeHtml {
  return html`<h3>Profil</h3>
${statusMessage(s.message)}
<div class="row">
    <div class="col-xl-6">
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            ${floatingInput({ name: 'username', label: 'Nazwa użytkownika', value: user.user_name, placeholder: 'Wybierz nazwę użytkownika.', disabled: true })}
            ${floatingInput({ name: 'PhoneNumber', label: 'Numer telefonu', type: 'tel', value: s.values.PhoneNumber ?? user.phone_number ?? '', placeholder: 'Podaj numer telefonu', errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Zapisz</button>
        </form>
    </div>
</div>`;
}

export function emailPage(request: FastifyRequest, user: User, s: FormState): SafeHtml {
  const confirmed = user.email_confirmed === 1;
  return html`<h3>Zarządzaj adresem e-mail</h3>
${statusMessage(s.message)}
<div class="row">
    <div class="col-xl-6">
        <form action="/Account/Manage/SendVerificationEmail" method="post" id="send-verification-form">
            ${csrfField(request)}
        </form>
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            ${confirmed
              ? html`<div class="form-floating mb-3 input-group">
                <input type="text" value="${user.email}" id="email" class="form-control" placeholder="Podaj adres e-mail" disabled />
                <div class="input-group-append">
                    <span class="h-100 input-group-text text-success font-weight-bold">✓</span>
                </div>
                <label for="email" class="form-label">E-mail</label>
            </div>`
              : html`<div class="form-floating mb-3">
                <input type="text" value="${user.email}" id="email" class="form-control" placeholder="Podaj adres e-mail" disabled />
                <label for="email" class="form-label">E-mail</label>
                <button type="submit" class="btn btn-link" form="send-verification-form">Wyślij e-mail weryfikacyjny</button>
            </div>`}
            ${floatingInput({ name: 'NewEmail', label: 'Nowy e-mail', type: 'email', value: s.values.NewEmail ?? user.email, autocomplete: 'email', placeholder: 'Podaj nowy adres e-mail', required: true, errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Zmień e-mail</button>
        </form>
    </div>
</div>`;
}

export function changePasswordPage(request: FastifyRequest, s: FormState): SafeHtml {
  return html`<h3>Zmień hasło</h3>
${statusMessage(s.message)}
<div class="row">
    <div class="col-xl-6">
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            ${floatingInput({ name: 'OldPassword', label: 'Obecne hasło', type: 'password', autocomplete: 'current-password', placeholder: 'Podaj obecne hasło', required: true, errors: s.errors })}
            ${floatingInput({ name: 'NewPassword', label: 'Nowe hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Podaj nowe hasło', required: true, errors: s.errors })}
            ${floatingInput({ name: 'ConfirmPassword', label: 'Powtórz nowe hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Powtórz nowe hasło', required: true, errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Zmień hasło</button>
        </form>
    </div>
</div>`;
}

export function setPasswordPage(request: FastifyRequest, s: FormState): SafeHtml {
  return html`<h3>Ustaw hasło</h3>
${statusMessage(s.message)}
<p class="text-info">Nie masz jeszcze hasła do tej strony. Ustaw je, aby móc się zalogować.</p>
<div class="row">
    <div class="col-xl-6">
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            ${floatingInput({ name: 'NewPassword', label: 'Nowe hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Podaj nowe hasło', errors: s.errors })}
            ${floatingInput({ name: 'ConfirmPassword', label: 'Powtórz nowe hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Powtórz nowe hasło', errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Ustaw hasło</button>
        </form>
    </div>
</div>`;
}

export function personalDataPage(request: FastifyRequest, message: string | null): SafeHtml {
  return html`${statusMessage(message)}
<h3>Dane osobowe</h3>
<div class="row">
    <div class="col-md-6">
        <p>Twoje konto zawiera dane osobowe, które nam podałeś. Na tej stronie możesz je pobrać lub usunąć.</p>
        <p><strong>Usunięcie tych danych trwale usunie twoje konto – tej operacji nie można cofnąć.</strong></p>
        <form action="/Account/Manage/DownloadPersonalData" method="post">
            ${csrfField(request)}
            <button class="btn btn-primary" type="submit">Pobierz</button>
        </form>
        <p><a href="/Account/Manage/DeletePersonalData" class="btn btn-danger">Usuń</a></p>
    </div>
</div>`;
}

export function deletePersonalDataPage(request: FastifyRequest, s: FormState, requirePassword: boolean): SafeHtml {
  return html`${statusMessage(s.message)}
<h3>Usuń dane osobowe</h3>
<div class="alert alert-warning" role="alert">
    <p><strong>Usunięcie tych danych trwale usunie twoje konto – tej operacji nie można cofnąć.</strong></p>
</div>
<div>
    <form method="post" novalidate>
        ${csrfField(request)}
        ${validationSummary(s.errors)}
        ${requirePassword && floatingInput({ name: 'Password', label: 'Hasło', type: 'password', autocomplete: 'current-password', placeholder: 'Podaj hasło.', required: true, errors: s.errors })}
        <button class="w-100 btn btn-lg btn-danger" type="submit">Usuń dane i zamknij moje konto</button>
    </form>
</div>`;
}
