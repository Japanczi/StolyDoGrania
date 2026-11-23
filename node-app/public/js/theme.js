// @ts-check
// The colour theme picker in the menu drawer (layout.ts, themePicker). Picking a theme:
//  1. sets data-theme on <html> – themes.css swaps every colour through CSS custom properties, so the page
//     (popups added to <body> included) recolours at once, with no reload and no request;
//  2. remembers the choice in the "theme" cookie for a year, so the server renders the next page in it straight
//     away (src/web/theme.ts). A cookie rather than localStorage because the server can read it: with
//     localStorage the page would first paint in the default theme and then flip.

const picker = document.querySelector('[data-theme-picker]');
const root = document.documentElement;

if (picker) {
  picker.addEventListener('change', event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.name !== 'theme') {
      return;
    }
    root.dataset.theme = input.value;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `theme=${encodeURIComponent(input.value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  });
}
