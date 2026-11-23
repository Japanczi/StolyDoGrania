// Colour themes: which ones exist and which one a request gets.
// The colours themselves live in public/css/themes.css (one block of CSS custom properties per theme); this file
// only knows their ids and names. The choice is a plain cookie set by public/js/theme.js, so it works for guests
// too and needs no database. The server reads it to write data-theme into the page, so the first paint already
// has the right colours (no flash of the default theme).

export const themes = [
  { id: 'szczecin', label: 'Barwy Szczecina', swatch: ['#1d4f91', '#2a1217', '#e7b53c'] },
  { id: 'amber', label: 'Grafit i bursztyn', swatch: ['#a1a1a8', '#f4f3ef', '#f2b33d'] },
  { id: 'green', label: 'Grafit i zieleń', swatch: ['#17703f', '#4cc37a', '#e0b243'] },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

/** Used when the cookie is missing or holds something we don't know (an old or hand-edited value). */
export const defaultTheme: ThemeId = 'szczecin';

/** Name of the cookie public/js/theme.js writes. Not HttpOnly: the browser script sets it. */
export const themeCookie = 'theme';

/** The theme for a cookie value; anything unknown falls back to the default. */
export function themeFromCookie(value: string | undefined): ThemeId {
  return themes.find(theme => theme.id === value)?.id ?? defaultTheme;
}
