// The "Dziennik działań" page. Port of the markup of Components/Pages/Admin/Logs.razor (a plain GET form, no JS).

import { logActions, type LogAction, type LogPage } from '../../../db/queries/logs.ts';
import { html, type SafeHtml } from '../../html.ts';

const actionLabels: Record<LogAction, string> = {
  JoinedTable: 'Dołączenie do stołu',
  RoleChanged: 'Zmiana roli',
  UserRemoved: 'Usunięcie konta',
};

const actionBadges: Record<LogAction, string> = {
  JoinedTable: 'text-bg-success',
  RoleChanged: 'text-bg-warning',
  UserRemoved: 'text-bg-danger',
};

const polishTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Formats a stored UTC ISO timestamp as "yyyy-MM-dd HH:mm:ss" in Polish time, whatever the server's own zone is. */
export function toPolishTime(utcIso: string): string {
  // Stored values are UTC; add the "Z" if a value lacks a zone designator.
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utcIso) ? utcIso : `${utcIso}Z`);
  if (Number.isNaN(date.getTime())) {
    return utcIso;
  }
  const p: Record<string, string> = {};
  for (const part of polishTime.formatToParts(date)) {
    p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function logsPage(o: { data: LogPage; action: LogAction | null; search: string; error?: string }): SafeHtml {
  const { data } = o;
  const pageLink = (page: number): string => {
    const params = new URLSearchParams();
    if (o.action !== null) params.set('action', o.action);
    if (o.search.trim() !== '') params.set('q', o.search);
    if (page > 0) params.set('page', String(page + 1));
    const query = params.toString();
    return `/admin/logs${query ? `?${query}` : ''}`;
  };
  const dash = '—';

  return html`
<h1>Dziennik działań</h1>

<form class="row g-2 align-items-end mb-3" method="get" action="/admin/logs">
  <div class="col-sm-4 col-md-3">
    <label class="form-label" for="log-action">Akcja</label>
    <select id="log-action" name="action" class="form-select form-select-sm">
      <option value="">Wszystkie</option>
      ${logActions.map(a => a === o.action
        ? html`<option value="${a}" selected>${actionLabels[a]}</option>`
        : html`<option value="${a}">${actionLabels[a]}</option>`)}
    </select>
  </div>
  <div class="col-sm-5 col-md-4">
    <label class="form-label" for="log-search">Szukaj</label>
    <input id="log-search" name="q" class="form-control form-control-sm" maxlength="100"
           placeholder="Użytkownik, gra, szczegóły" value="${o.search}" />
  </div>
  <div class="col-auto">
    <button type="submit" class="btn btn-primary btn-sm">Szukaj</button>
  </div>
</form>

${o.error ? html`<div class="alert alert-danger">${o.error}</div>` : null}

${data.rows.length === 0 ? (o.error ? null : html`<p>Brak wpisów.</p>`) : html`
<table class="table table-sm align-middle">
  <thead>
    <tr><th style="width:170px">Czas</th><th style="width:170px">Akcja</th><th>Kto</th><th>Kogo dotyczy</th><th>Szczegóły</th></tr>
  </thead>
  <tbody>
    ${data.rows.map(r => html`
    <tr>
      <td class="text-nowrap">${toPolishTime(r.createdUtc)}</td>
      <td><span class="badge ${actionBadges[r.action]}">${actionLabels[r.action]}</span></td>
      <td>${r.actorName ?? dash}</td>
      <td>${r.targetName ?? dash}</td>
      <td>${r.details}</td>
    </tr>`)}
  </tbody>
</table>

<div class="d-flex align-items-center gap-2">
  ${data.page === 0
    ? html`<span class="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">← Nowsze</span>`
    : html`<a class="btn btn-outline-secondary btn-sm" href="${pageLink(data.page - 1)}">← Nowsze</a>`}
  <span>Strona ${data.page + 1} z ${data.pageCount} (wpisów: ${data.total})</span>
  ${data.page + 1 >= data.pageCount
    ? html`<span class="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">Starsze →</span>`
    : html`<a class="btn btn-outline-secondary btn-sm" href="${pageLink(data.page + 1)}">Starsze →</a>`}
</div>`}`;
}
