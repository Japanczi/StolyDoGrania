// Helpers for HTML forms: reading posted fields, showing validation errors and status messages.
// What Blazor's EditForm, InputText, ValidationSummary, ValidationMessage, <AntiforgeryToken /> and the
// scaffolded StatusMessage component did.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { html, type SafeHtml } from './html.ts';

/** Posted form fields by name. Missing fields read as ''. */
export type FormValues = Record<string, string>;

/** Error messages per field name ('' = for the whole form). */
export type FieldErrors = Record<string, string[]>;

/**
 * Turns a parsed form body into plain strings. @fastify/formbody gives an object whose values are strings, or
 * arrays when a name repeats; anything else (no body, JSON) gives an empty form. Nothing here is trusted yet.
 */
export function readForm(body: unknown): FormValues {
  const values: FormValues = {};
  if (typeof body !== 'object' || body === null) {
    return values;
  }
  for (const [name, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      values[name] = value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      values[name] = value[0];
    }
  }
  return values;
}

export function field(form: FormValues, name: string): string {
  return form[name] ?? '';
}

export function addError(errors: FieldErrors, name: string, message: string): void {
  (errors[name] ??= []).push(message);
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(list => list.length > 0);
}

/** The hidden CSRF field every POST form needs (see auth/csrf.ts). */
export function csrfField(request: FastifyRequest): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${request.csrfToken}" />`;
}

/** All errors in one list above the form, like Blazor's <ValidationSummary>. */
export function validationSummary(errors: FieldErrors): SafeHtml {
  const all = Object.values(errors).flat();
  return html`${all.length > 0 && html`<ul class="text-danger validation-errors" role="alert">${all.map(e => html`<li class="validation-message">${e}</li>`)}</ul>`}`;
}

/**
 * A green or red alert, like the scaffolded StatusMessage component: messages starting with "Błąd" are errors.
 */
export function statusMessage(message: string | null): SafeHtml {
  if (!message) {
    return html``;
  }
  const kind = message.startsWith('Błąd') ? 'danger' : 'success';
  return html`<div class="alert alert-${kind}" role="alert">${message}</div>`;
}

export type InputOptions = {
  name: string;
  label: string;
  value?: string;
  type?: 'text' | 'email' | 'password' | 'tel';
  autocomplete?: string;
  placeholder?: string;
  help?: string;
  disabled?: boolean;
  required?: boolean;
  errors?: FieldErrors;
};

/** A Bootstrap "floating label" input with its error messages, the markup the Identity pages used. */
export function floatingInput(o: InputOptions): SafeHtml {
  const fieldErrors = o.errors?.[o.name] ?? [];
  const invalid = fieldErrors.length > 0;
  // Passwords are never sent back into the page.
  const value = o.type === 'password' ? '' : (o.value ?? '');
  return html`<div class="form-floating mb-3">
    <input type="${o.type ?? 'text'}" name="${o.name}" id="${o.name}" value="${value}" class="form-control${invalid ? ' is-invalid' : ''}"
           placeholder="${o.placeholder ?? o.label}"${o.autocomplete ? html` autocomplete="${o.autocomplete}"` : ''}${o.required ? html` aria-required="true"` : ''}${invalid ? html` aria-invalid="true"` : ''}${o.disabled ? html` disabled` : ''} />
    <label for="${o.name}" class="form-label">${o.label}</label>
    ${o.help && html`<div class="form-text">${o.help}</div>`}
    ${fieldErrors.map(e => html`<div class="text-danger validation-message">${e}</div>`)}
</div>`;
}

/**
 * Only allows redirects to our own pages: a path starting with a single "/". Anything else ("https://evil",
 * "//evil", "/\evil") becomes the fallback – otherwise a link like Login?ReturnUrl=https://evil could send users
 * to another site after logging in (an "open redirect"). ASP.NET Core's LocalRedirect did this check.
 */
export function safeReturnUrl(value: string | undefined, fallback = '/'): string {
  if (!value) {
    return fallback;
  }
  // "stoly" etc.: the .NET app's links used paths without the leading slash.
  const path = value.startsWith('/') ? value : `/${value}`;
  return /^\/(?![/\\])[^\s]*$/.test(path) ? path : fallback;
}

// ---------- one-time status messages across a redirect ----------

const flashCookie = 'flash';

/**
 * Shows a message on the next page after a redirect (Post/Redirect/Get), as Identity's RedirectToCurrentPageWithStatus
 * did with its "Identity.StatusMessage" cookie.
 */
export function setFlash(reply: FastifyReply, message: string): void {
  reply.setCookie(flashCookie, message, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 });
}

/** Reads and removes the flash message. */
export function takeFlash(request: FastifyRequest, reply: FastifyReply): string | null {
  const message = request.cookies[flashCookie];
  if (message === undefined) {
    return null;
  }
  reply.clearCookie(flashCookie, { path: '/' });
  return message;
}
