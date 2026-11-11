// @ts-check
// The feedback box: opens/closes the card, counts characters and POSTs the comment to /api/feedback.
// Was FeedbackBox.razor (a Blazor component); here the server renders the markup and this script drives it.

(() => {
  const box = document.getElementById('feedback-box');
  if (!box) return;

  const card = /** @type {HTMLElement} */ (document.getElementById('feedback-card'));
  const bubble = /** @type {HTMLButtonElement} */ (document.getElementById('feedback-bubble'));
  const closeButton = /** @type {HTMLButtonElement} */ (document.getElementById('feedback-close'));
  const text = /** @type {HTMLTextAreaElement} */ (document.getElementById('feedback-text'));
  const count = /** @type {HTMLElement} */ (document.getElementById('feedback-count'));
  const send = /** @type {HTMLButtonElement} */ (document.getElementById('feedback-send'));
  const status = /** @type {HTMLElement} */ (document.getElementById('feedback-status'));
  const max = Number(box.dataset.max) || 4000;
  const csrfToken = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="csrf-token"]'))?.content ?? '';
  let saving = false;

  /** @param {boolean} open */
  function setOpen(open) {
    card.hidden = !open;
    bubble.textContent = open ? '✕' : '💬';
    bubble.classList.toggle('is-open', open);
    bubble.setAttribute('aria-expanded', String(open));
    bubble.setAttribute('aria-label', open ? 'Zamknij uwagi' : 'Zgłoś uwagę');
    bubble.title = open ? 'Zamknij' : 'Zgłoś uwagę';
    if (open) text.focus();
  }

  function refresh() {
    count.textContent = `${text.value.length}/${max}`;
    send.disabled = saving || text.value.trim() === '';
  }

  /** @param {string} message @param {boolean} failed */
  function showStatus(message, failed) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('text-danger', failed);
    status.classList.toggle('text-success', !failed);
  }

  async function save() {
    if (saving || text.value.trim() === '') return;
    saving = true;
    refresh();
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        // The page is read now, so it is the subpage the user is on at this moment.
        body: JSON.stringify({ message: text.value, page: location.pathname + location.search + location.hash }),
        credentials: 'same-origin',
      });
      const type = response.headers.get('content-type') ?? '';
      const result = type.includes('application/json') ? await response.json() : null;
      if (result?.ok) {
        text.value = '';
        showStatus(result.message, false);
      } else {
        // The typed text stays in the box, so nothing is lost and it can be retried.
        showStatus(result?.error ?? 'Nie udało się zapisać uwagi. Spróbuj ponownie.', true);
      }
    } catch {
      showStatus('Nie udało się zapisać uwagi. Spróbuj ponownie.', true);
    } finally {
      saving = false;
      refresh();
    }
  }

  bubble.addEventListener('click', () => setOpen(card.hidden === true));
  closeButton.addEventListener('click', () => setOpen(false));
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setOpen(false);
      bubble.focus();
    }
  });
  text.addEventListener('input', refresh);
  send.addEventListener('click', save);
  refresh();
})();
