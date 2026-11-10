// The `html` tagged template: builds HTML strings and escapes every interpolated value.
// This is our whole "template engine" – the counterpart of Razor's @value escaping.
// See docs/learning/server-rendered-html.md.

/**
 * A piece of HTML that is already safe to output: produced by `html` (which escaped its values) or, rarely,
 * by `raw`. Wrapping it in a class lets `html` tell "trusted markup" apart from "text that needs escaping".
 */
export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * What may appear inside `${…}` in an `html` template:
 * text and numbers are escaped, SafeHtml is inserted as is, arrays are joined,
 * and null / undefined / false render nothing (so `${isAdmin && html`…`}` works).
 */
export type HtmlValue = SafeHtml | string | number | null | undefined | false | readonly HtmlValue[];

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for use in HTML content and in quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => escapes[ch] ?? ch);
}

function render(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(render).join('');
  }
  return escapeHtml(String(value));
}

/**
 * Tag function: `html`<p>${name}</p>`` calls this with the fixed text parts (`strings`) and the
 * interpolated values separately, so only the values get escaped.
 */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? '');
  }
  return new SafeHtml(out);
}

/**
 * Marks a string as trusted HTML, skipping escaping. DANGEROUS: never pass anything that contains user input.
 * Only for fixed markup written in our own code.
 */
export function raw(trustedMarkup: string): SafeHtml {
  return new SafeHtml(trustedMarkup);
}
