// Template of "Użytkownicy" (/admin/users). Port of the markup in Components/Pages/Admin/Users.razor.
// E-mail addresses are shown here because the page is admin-only (never publicly).

import type { FastifyRequest } from 'fastify';
import type { Role } from '../../../db/schema.ts';
import { csrfField, validationSummary, type FieldErrors } from '../../forms.ts';
import { html, type SafeHtml } from '../../html.ts';

export type UserRow = { id: string; userName: string; email: string; role: Role; isSelf: boolean; manageable: boolean };

const hint = 'Tylko główny administrator (Owner) może odebrać rolę administratora lub usunąć jego konto.';
const assignable = [['admin', 'Admin'], ['user', 'User']] as const;

export function usersPage(request: FastifyRequest, m: {
  rows: UserRow[]; confirmDeleteId: string; status: string | null; error: string | null; errors: FieldErrors; values: Record<string, string>;
}): SafeHtml {
  const newRole = m.values.Role ?? 'user';
  return html`<h1>Zarządzanie użytkownikami</h1>
<p><a href="/admin/logs">Dziennik działań</a> – dołączenia do stołów, zmiany ról i usunięcia kont.</p>
${m.status && html`<div class="alert alert-success" role="alert">${m.status}</div>`}
${m.error && html`<div class="alert alert-danger" role="alert">${m.error}</div>`}
<div class="card mb-4">
    <div class="card-body">
        <h5 class="card-title">Dodaj użytkownika</h5>
        <form method="post" action="/admin/users/add" novalidate>
            ${csrfField(request)}
            ${validationSummary(m.errors)}
            <div class="row g-3">
                <div class="col-md-3">
                    <label class="form-label" for="nu-name">Nazwa użytkownika</label>
                    <input id="nu-name" name="UserName" class="form-control" value="${m.values.UserName ?? ''}" />
                </div>
                <div class="col-md-3">
                    <label class="form-label" for="nu-email">E-mail</label>
                    <input id="nu-email" name="Email" class="form-control" value="${m.values.Email ?? ''}" />
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="nu-pass">Hasło</label>
                    <input id="nu-pass" name="Password" type="password" class="form-control" autocomplete="new-password" />
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="nu-role">Rola</label>
                    <select id="nu-role" name="Role" class="form-select">
                        ${assignable.map(([value, label]) => html`<option value="${value}"${value === newRole ? html` selected` : ''}>${label}</option>`)}
                    </select>
                </div>
                <div class="col-md-2 d-flex align-items-end">
                    <button type="submit" class="btn btn-success w-100">Dodaj</button>
                </div>
            </div>
        </form>
    </div>
</div>
<table class="table align-middle">
    <thead><tr><th>Nazwa użytkownika</th><th>E-mail</th><th style="width:180px">Rola</th><th style="width:220px"></th></tr></thead>
    <tbody>
        ${m.rows.map(u => row(request, u, m.confirmDeleteId === u.id))}
    </tbody>
</table>`;
}

function row(request: FastifyRequest, u: UserRow, confirming: boolean): SafeHtml {
  const locked = u.isSelf || !u.manageable;
  return html`<tr>
            <td>${u.userName} ${u.isSelf && html`<span class="badge text-bg-secondary">to Ty</span>`}</td>
            <td>${u.email}</td>
            <td>${u.role === 'owner'
              ? html`<span class="badge text-bg-warning" title="Główny administrator">Owner</span>`
              : html`<form method="post" action="/admin/users/${u.id}/role" class="m-0">
                    ${csrfField(request)}
                    <select name="Role" class="form-select form-select-sm" data-autosubmit${locked ? html` disabled` : ''}${!u.isSelf && !u.manageable ? html` title="${hint}"` : ''}>
                        ${assignable.map(([value, label]) => html`<option value="${value}"${value === u.role ? html` selected` : ''}>${label}</option>`)}
                    </select>
                    <noscript><button type="submit" class="btn btn-sm btn-outline-light mt-1"${locked ? html` disabled` : ''}>Zapisz</button></noscript>
                </form>`}</td>
            <td class="text-end">${!locked && (confirming
              ? html`<form method="post" action="/admin/users/${u.id}/delete" class="d-inline">
                    ${csrfField(request)}
                    <button type="submit" class="btn btn-sm btn-danger">Potwierdź usunięcie</button>
                </form>
                <a class="btn btn-sm btn-outline-secondary" href="/admin/users">Anuluj</a>`
              : html`<a class="btn btn-sm btn-outline-danger" href="/admin/users?usun=${u.id}">Usuń</a>`)}</td>
        </tr>`;
}
