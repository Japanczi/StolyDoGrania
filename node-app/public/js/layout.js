// @ts-check
// Menu drawer helpers. The drawer opens and closes with CSS alone (a hidden checkbox, see css/layout.css);
// this script only adds what CSS can't do: closing it on Escape and when a link or button inside is used.
// Was inline onclick/onkeydown attributes in MainLayout.razor.

const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('app-menu-toggle'));
const drawer = document.getElementById('app-drawer');

if (toggle && drawer) {
  drawer.addEventListener('click', event => {
    const target = /** @type {Element} */ (event.target);
    if (target.closest('a, button')) {
      toggle.checked = false;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.checked) {
      toggle.checked = false;
      toggle.focus();
    }
  });
}
