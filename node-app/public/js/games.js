// @ts-check
// "Baza gier": the two-click delete, search-as-you-type, and dismissing the message. Everything else is plain HTML.

(() => {
  /** @type {{ button: HTMLButtonElement, timer: number, backdrop: HTMLElement } | null} */
  let armed = null;

  function disarm() {
    if (!armed) return;
    const { button, backdrop, timer } = armed;
    armed = null;
    clearTimeout(timer);
    backdrop.remove();
    button.classList.remove('armed');
    button.innerHTML = button.dataset.original ?? '❌';
    button.title = button.dataset.title ?? 'Usuń grę z bazy';
    button.setAttribute('aria-label', button.dataset.label ?? '');
  }

  // First click arms (solid green ✓), the second submits the form; Escape, a click elsewhere or 4 s disarm it.
  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest('button[data-confirm-delete]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    if (armed?.button === button) {
      disarm();
      return; // the click goes on and submits the form
    }
    e.preventDefault();
    disarm();
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.addEventListener('click', disarm);
    backdrop.addEventListener('contextmenu', ev => { ev.preventDefault(); disarm(); });
    document.body.append(backdrop);
    button.dataset.original = button.innerHTML;
    button.dataset.title = button.title;
    button.dataset.label = button.getAttribute('aria-label') ?? '';
    button.classList.add('armed');
    button.innerHTML = '<span class="confirm-check" aria-hidden="true">✓</span>';
    button.title = button.dataset.armedTitle ?? '';
    button.setAttribute('aria-label', button.dataset.armedLabel ?? '');
    button.focus();
    armed = { button, backdrop, timer: window.setTimeout(disarm, 4000) };
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') disarm();
  });

  // Search as you type: submit the (GET) form shortly after the last key, keeping the cursor at the end after the reload.
  const search = document.querySelector('input[data-search]');
  if (search instanceof HTMLInputElement) {
    if (search.value !== '') {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => search.form?.requestSubmit(), 400);
    });
  }

  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    const close = target?.closest('[data-dismiss-alert]');
    if (close) close.closest('.alert')?.remove();
  });
})();
