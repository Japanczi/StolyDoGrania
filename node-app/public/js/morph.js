// @ts-check
// "Morphing": update the page to match new HTML from the server by changing only what differs, instead of
// replacing elements. Replacing (innerHTML / outerHTML / a full page load) throws the old elements away, so the
// browser repaints everything – images flash, focus and scroll are lost. Morphing keeps every element that is still
// there and only fixes its attributes and text. This is what Blazor's DOM diffing did for us automatically.
// The same idea as libraries like idiomorph or morphdom, hand-written in ~100 lines. See docs/learning/no-flash.md.

/**
 * Makes the children of `target` look like the children of `source` (a parsed fragment or element).
 * `source` is consumed: nodes that are new get moved from it into the page.
 * @param {ParentNode & Node} target
 * @param {ParentNode & Node} source
 */
function morphChildren(target, source) {
  const wanted = [...source.childNodes];
  for (let i = 0; i < wanted.length; i++) {
    const next = /** @type {ChildNode} */ (wanted[i]);
    const current = target.childNodes[i] ?? null;
    // An element with an id (e.g. a table row "table-12") is matched by id, even if it moved.
    const key = keyOf(next);
    const match = key ? findByKey(target, key, i) : current;
    if (match && sameKind(match, next)) {
      if (match !== current) target.insertBefore(match, current);
      patch(match, next);
    } else {
      target.insertBefore(next, current);
    }
  }
  // Whatever is left after the wanted nodes isn't in the new HTML any more.
  while (target.childNodes.length > wanted.length) {
    /** @type {ChildNode} */ (target.lastChild).remove();
  }
}

/**
 * Makes `target` (an element on the page) look like `source` (a parsed element with the same tag).
 * @param {Element} target
 * @param {Element} source
 */
function morphElement(target, source) {
  if (!sameKind(target, source)) {
    target.replaceWith(source);
    return;
  }
  patch(target, source);
}

/** @param {Node} node */
function keyOf(node) {
  return node instanceof Element ? node.id || null : null;
}

/** @param {ParentNode & Node} parent @param {string} key @param {number} from */
function findByKey(parent, key, from) {
  for (let i = from; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node instanceof Element && node.id === key) return node;
  }
  return null;
}

/** Same node type, and for elements the same tag and the same id (or both without one). @param {Node} a @param {Node} b */
function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a instanceof Element && b instanceof Element) return a.tagName === b.tagName && a.id === b.id;
  return true;
}

/** @param {Node} target @param {Node} source */
function patch(target, source) {
  if (!(target instanceof Element) || !(source instanceof Element)) {
    if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
    return;
  }
  // Attributes: remove the old ones that are gone, set the ones that changed (unchanged ones are left alone,
  // so e.g. an <img> with the same src isn't reloaded).
  for (const attr of [...target.attributes]) {
    if (!source.hasAttribute(attr.name)) target.removeAttribute(attr.name);
  }
  for (const attr of [...source.attributes]) {
    if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
  }
  morphChildren(target, source);
  syncFormState(target, source);
}

/**
 * Inputs keep their *current* value in a property, not in the attribute, so it's copied explicitly – except for
 * the field the user is typing in right now.
 * @param {Element} target @param {Element} source
 */
function syncFormState(target, source) {
  if (target === document.activeElement) return;
  if (target instanceof HTMLInputElement && source instanceof HTMLInputElement) {
    if (target.type === 'checkbox' || target.type === 'radio') target.checked = source.hasAttribute('checked');
    else if (target.type !== 'file') target.value = source.getAttribute('value') ?? '';
  } else if (target instanceof HTMLTextAreaElement) {
    target.value = source.textContent ?? '';
  } else if (target instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
    const selected = source.querySelector('option[selected]');
    target.value = selected ? selected.getAttribute('value') ?? '' : /** @type {HTMLOptionElement | null} */ (target.options[0])?.value ?? '';
  }
}

/** Parses an HTML string into a fragment (scripts in it don't run). @param {string} html */
function parseFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

// Shared with board.js and enhance.js (plain scripts, no modules or bundler).
window.morph = { morphChildren, morphElement, parseFragment };
