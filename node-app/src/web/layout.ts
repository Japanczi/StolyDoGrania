// The one page layout: top ribbon + slide-in menu drawer + page content.
// Port of Components/App.razor, Components/Layout/MainLayout.razor and NavMenu.razor.
// The drawer is still CSS-only (a hidden checkbox + `:checked ~` selectors in public/css/layout.css);
// public/js/layout.js only adds closing on Escape and on following a link.

import { html, type SafeHtml } from './html.ts';

/** The signed-in user as the layout needs it, or null when logged out. */
export type LayoutUser = {
  /** Never a full e-mail address (CLAUDE.md): the user name, or the part before '@'. */
  shortName: string;
  isAdmin: boolean;
};

export type PageOptions = {
  /** Text of the browser tab, like Blazor's <PageTitle>. */
  title: string;
  /** The request path, used to highlight the current menu entry. */
  currentPath: string;
  user: LayoutUser | null;
  /** For the hidden field of the logout forms (see auth/csrf.ts). */
  csrfToken: string;
  body: SafeHtml;
  /** Extra <link>/<meta> tags for this page (e.g. board.css). */
  head?: SafeHtml;
  /** Extra <script> tags, loaded after the layout script. */
  scripts?: SafeHtml;
};

/** Renders a complete HTML document around a page's body. */
export function layout({ title, currentPath, user, csrfToken, body, head, scripts }: PageOptions): SafeHtml {
  /** Logout is a POST (a link could be triggered by other sites), protected by the CSRF token like every form. */
  const logoutForm = (returnUrl: string, button: SafeHtml) => html`<form action="/Account/Logout" method="post">
                <input type="hidden" name="_csrf" value="${csrfToken}" />
                <input type="hidden" name="ReturnUrl" value="${returnUrl}" />
                ${button}
            </form>`;

  return html`<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- For fetch() calls from page scripts: sent back in the x-csrf-token header (see auth/csrf.ts). -->
    <meta name="csrf-token" content="${csrfToken}" />
    <title>${title}</title>
    <link rel="stylesheet" href="/lib/bootstrap/css/bootstrap.min.css" />
    <link rel="stylesheet" href="/css/app.css" />
    <link rel="stylesheet" href="/css/layout.css" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    ${head}
</head>
<body>
<div class="app board-theme" data-bs-theme="dark">
    <!-- Must stay before the ribbon, backdrop and drawer: the CSS uses ":checked ~" sibling selectors.
         Visually hidden but focusable, so Tab + Space opens the menu. -->
    <input type="checkbox" id="app-menu-toggle" class="app-menu-toggle" aria-label="Pokaż menu" aria-controls="app-drawer" />

    <header class="app-bar">
        <a class="app-brand" href="/">Planszówkarz</a>
        <nav class="app-bar-nav" aria-label="Nawigacja">
            <label for="app-menu-toggle" class="btn btn-outline-light btn-sm app-menu-button">Menu</label>
            ${user && html`<a class="btn btn-outline-light btn-sm app-user" href="/Account/Manage" title="Profil">${user.shortName}</a>`}
        </nav>
        <div class="app-bar-auth">
            ${user ? logoutForm('/', html`<button type="submit" class="btn btn-outline-light btn-sm">Wyloguj</button>`)
                   : html`<a class="btn btn-outline-light btn-sm" href="/Account/Login?ReturnUrl=%2F">Zaloguj się</a>`}
        </div>
    </header>

    <label for="app-menu-toggle" class="app-drawer-backdrop" aria-hidden="true"></label>

    <aside id="app-drawer" class="app-drawer" aria-label="Menu">
        ${drawer(currentPath, user, logoutForm(currentPath, html`<button type="submit" class="drawer-link"><span class="bi bi-arrow-bar-left-nav-menu" aria-hidden="true"></span> Wyloguj</button>`))}
    </aside>

    <main class="app-main">
        ${body}
    </main>
</div>
<script src="/js/layout.js"></script>
${scripts}
</body>
</html>`;
}

function drawer(currentPath: string, user: LayoutUser | null, logout: SafeHtml): SafeHtml {
  return html`<div class="drawer-head">
            <span class="drawer-title">Menu</span>
            <label for="app-menu-toggle" class="drawer-close" title="Zamknij menu" aria-label="Zamknij menu">✕</label>
        </div>
        <nav class="drawer-nav flex-column">
            ${navLink('/', 'list-nested', 'Zapisy na gry', currentPath)}
            ${navLink('/gry', 'collection', 'Baza gier', currentPath)}
            ${user?.isAdmin && [
              navLink('/admin/users', 'person-badge', 'Użytkownicy', currentPath),
              navLink('/admin/logs', 'journal-text', 'Dziennik', currentPath),
            ]}
            <hr class="drawer-sep" />
            ${user
              ? [
                  navLink('/Account/Manage', 'person-fill', `Profil (${user.shortName})`, currentPath),
                  logout,
                ]
              : [
                  navLink('/Account/Register', 'person', 'Zarejestruj się', currentPath),
                  navLink('/Account/Login', 'person-badge', 'Zaloguj się', currentPath),
                ]}
        </nav>
        <!-- Bottom-right corner of the menu. Required by BGG's XML API terms for public-facing uses. -->
        <div class="drawer-foot">
            <a class="bgg-credit" href="https://boardgamegeek.com/" target="_blank" rel="noopener noreferrer" title="Dane gier: BoardGameGeek">
                <img src="/images/powered-by-bgg.png" alt="Powered by BoardGameGeek" />
            </a>
        </div>`;
}

/** A drawer entry; "active" on the current page, like Blazor's NavLink. "/stoly" is an alias of "/". */
function navLink(href: string, icon: string, label: string, currentPath: string): SafeHtml {
  const path = currentPath === '/stoly' ? '/' : currentPath;
  const active = path === href;
  return html`<a class="drawer-link${active ? ' active' : ''}" href="${href}"${active ? html` aria-current="page"` : ''}>
                <span class="bi bi-${icon}-nav-menu" aria-hidden="true"></span> ${label}
            </a>`;
}
