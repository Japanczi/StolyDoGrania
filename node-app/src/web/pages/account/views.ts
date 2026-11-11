// Templates of the public account pages. Ports of Components/Account/Pages/*.razor, same Polish wording.
// The forms post back to the same URL; routes.ts validates and either re-renders with errors or redirects.

import type { FastifyRequest } from 'fastify';
import { html, type SafeHtml } from '../../html.ts';
import { csrfField, floatingInput, statusMessage, validationSummary, type FieldErrors, type FormValues } from '../../forms.ts';

export type FormState = {
  values: FormValues;
  errors: FieldErrors;
  message: string | null;
};

export const emptyForm: FormState = { values: {}, errors: {}, message: null };

export function loginPage(request: FastifyRequest, s: FormState, returnUrl: string | undefined): SafeHtml {
  const registerHref = returnUrl ? `/Account/Register?ReturnUrl=${encodeURIComponent(returnUrl)}` : '/Account/Register';
  return html`<h1>Logowanie</h1>
<div class="row">
    <div class="col-lg-6">
        <section>
            ${statusMessage(s.message)}
            <form method="post" novalidate>
                ${csrfField(request)}
                <h2>Zaloguj się na swoje konto.</h2>
                <hr />
                ${validationSummary(s.errors)}
                ${floatingInput({ name: 'Email', label: 'E-mail lub nazwa użytkownika', value: s.values.Email, autocomplete: 'username', placeholder: 'name@example.com', required: true, errors: s.errors })}
                ${floatingInput({ name: 'Password', label: 'Hasło', type: 'password', autocomplete: 'current-password', placeholder: 'password', required: true, errors: s.errors })}
                <div class="checkbox mb-3">
                    <label class="form-label">
                        <input type="checkbox" name="RememberMe" value="true" class="darker-border-checkbox form-check-input"${s.values.RememberMe === 'true' ? html` checked` : ''} />
                        Zapamiętaj mnie
                    </label>
                </div>
                <div>
                    <button type="submit" class="w-100 btn btn-lg btn-primary">Zaloguj się</button>
                </div>
                <hr />
                <div>
                    <p><a href="/Account/ForgotPassword">Nie pamiętasz hasła?</a></p>
                    <p><a href="${registerHref}">Zarejestruj się</a></p>
                    <p><a href="/Account/ResendEmailConfirmation">Wyślij ponownie e-mail z potwierdzeniem</a></p>
                </div>
            </form>
        </section>
    </div>
</div>`;
}

export function registerPage(request: FastifyRequest, s: FormState): SafeHtml {
  return html`<h1>Rejestracja</h1>
<div class="row">
    <div class="col-lg-6">
        ${statusMessage(s.message)}
        <form method="post" novalidate>
            ${csrfField(request)}
            <h2>Utwórz nowe konto.</h2>
            <hr />
            ${validationSummary(s.errors)}
            ${floatingInput({ name: 'UserName', label: 'Nazwa użytkownika', value: s.values.UserName, autocomplete: 'username', placeholder: 'nazwa', required: true, errors: s.errors,
                help: 'Widoczna dla innych graczy. 3–20 znaków: litery, cyfry, spacje, „.”, „_”, „-”.' })}
            ${floatingInput({ name: 'Email', label: 'E-mail', type: 'email', value: s.values.Email, autocomplete: 'email', placeholder: 'name@example.com', required: true, errors: s.errors })}
            ${floatingInput({ name: 'Password', label: 'Hasło', type: 'password', autocomplete: 'new-password', placeholder: 'password', required: true, errors: s.errors })}
            ${floatingInput({ name: 'ConfirmPassword', label: 'Powtórz hasło', type: 'password', autocomplete: 'new-password', placeholder: 'password', required: true, errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Zarejestruj się</button>
        </form>
    </div>
</div>`;
}

/** After registering. `confirmLink` is set only when no e-mail can be sent (local development). */
export function registerConfirmationPage(message: string | null, confirmLink: string | null): SafeHtml {
  return html`<h1>Potwierdzenie rejestracji</h1>
${statusMessage(message)}
${confirmLink !== null
    ? html`<p>Wysyłka e-maili nie jest jeszcze skonfigurowana, więc link potwierdzający wyświetlamy tutaj.
    <a href="${confirmLink}">Kliknij tutaj, aby potwierdzić konto</a></p>`
    : message === null && html`<p role="alert">Sprawdź swoją skrzynkę e-mail, aby potwierdzić konto.</p>`}`;
}

/** Confirm e-mail, confirm e-mail change: a heading and the result. */
export function resultPage(heading: string, message: string | null): SafeHtml {
  return html`<h1>${heading}</h1>
${statusMessage(message)}`;
}

/** The one-field "enter your e-mail" forms: resend confirmation and forgot password. */
export function emailOnlyPage(request: FastifyRequest, s: FormState, o: { heading: string; button: string }): SafeHtml {
  return html`<h1>${o.heading}</h1>
<h2>Podaj swój adres e-mail.</h2>
<hr />
${statusMessage(s.message)}
<div class="row">
    <div class="col-md-4">
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            ${floatingInput({ name: 'Email', label: 'E-mail', type: 'email', value: s.values.Email, autocomplete: 'username', placeholder: 'name@example.com', required: true, errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">${o.button}</button>
        </form>
    </div>
</div>`;
}

export function resetPasswordPage(request: FastifyRequest, s: FormState, code: string): SafeHtml {
  return html`<h1>Resetowanie hasła</h1>
<h2>Ustaw nowe hasło.</h2>
<hr />
<div class="row">
    <div class="col-md-4">
        ${statusMessage(s.message)}
        <form method="post" novalidate>
            ${csrfField(request)}
            ${validationSummary(s.errors)}
            <input type="hidden" name="Code" value="${code}" />
            ${floatingInput({ name: 'Email', label: 'E-mail', type: 'email', value: s.values.Email, autocomplete: 'username', placeholder: 'name@example.com', required: true, errors: s.errors })}
            ${floatingInput({ name: 'Password', label: 'Hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Podaj hasło.', required: true, errors: s.errors })}
            ${floatingInput({ name: 'ConfirmPassword', label: 'Powtórz hasło', type: 'password', autocomplete: 'new-password', placeholder: 'Powtórz hasło.', required: true, errors: s.errors })}
            <button type="submit" class="w-100 btn btn-lg btn-primary">Zresetuj</button>
        </form>
    </div>
</div>`;
}

/** Fixed-text pages: their heading and paragraph. */
export const infoPages = {
  forgotPasswordConfirmation: {
    title: 'Reset hasła – sprawdź e-mail',
    body: html`<h1>Reset hasła – sprawdź e-mail</h1>
<p role="alert">Sprawdź swoją skrzynkę e-mail, aby zresetować hasło.</p>`,
  },
  resetPasswordConfirmation: {
    title: 'Hasło zresetowane',
    body: html`<h1>Hasło zresetowane</h1>
<p role="alert">Twoje hasło zostało zresetowane. <a href="/Account/Login">Kliknij tutaj, aby się zalogować</a>.</p>`,
  },
  invalidPasswordReset: {
    title: 'Nieprawidłowy reset hasła',
    body: html`<h1>Nieprawidłowy reset hasła</h1>
<p role="alert">Link do resetowania hasła jest nieprawidłowy.</p>`,
  },
  lockout: {
    title: 'Konto zablokowane',
    body: html`<header>
    <h1 class="text-danger">Konto zablokowane</h1>
    <p class="text-danger" role="alert">To konto zostało tymczasowo zablokowane. Spróbuj ponownie później.</p>
</header>`,
  },
  accessDenied: {
    title: 'Odmowa dostępu',
    body: html`<header>
    <h1 class="text-danger">Odmowa dostępu</h1>
    <p class="text-danger">Nie masz dostępu do tej strony.</p>
</header>`,
  },
} as const;
