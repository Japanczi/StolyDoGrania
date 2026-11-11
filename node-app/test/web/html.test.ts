import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, html, raw, SafeHtml } from '../../src/web/html.ts';

describe('html tag', () => {
  test('escapes interpolated text', () => {
    const name = '<script>alert("x")</script>';
    assert.equal(html`<td>${name}</td>`.value, '<td>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</td>');
  });

  test('escapes quotes, so values are safe inside quoted attributes', () => {
    const title = `" onmouseover="alert(1)' x='`;
    assert.equal(html`<a title="${title}">`.value, '<a title="&quot; onmouseover=&quot;alert(1)&#39; x=&#39;">');
  });

  test('inserts nested html without escaping it again', () => {
    const inner = html`<b>${'a & b'}</b>`;
    assert.equal(html`<p>${inner}</p>`.value, '<p><b>a &amp; b</b></p>');
  });

  test('joins arrays and renders null, undefined and false as nothing', () => {
    const items = ['x', 'y'].map(i => html`<li>${i}</li>`);
    assert.equal(html`<ul>${items}${null}${undefined}${false}</ul>`.value, '<ul><li>x</li><li>y</li></ul>');
  });

  test('renders numbers, including zero', () => {
    assert.equal(html`<span>${0}</span><span>${2.0488}</span>`.value, '<span>0</span><span>2.0488</span>');
  });

  test('keeps Polish characters as they are', () => {
    assert.equal(html`${'Zapisy na gry – żółć'}`.value, 'Zapisy na gry – żółć');
  });

  test('raw skips escaping (only for our own fixed markup)', () => {
    assert.equal(html`${raw('<hr>')}`.value, '<hr>');
  });

  test('returns SafeHtml, which prints as its markup', () => {
    const result = html`<i>${'a'}</i>`;
    assert.ok(result instanceof SafeHtml);
    assert.equal(`${result}`, '<i>a</i>');
  });
});

describe('escapeHtml', () => {
  test('escapes the five special characters and nothing else', () => {
    assert.equal(escapeHtml(`&<>"'ąź/=`), '&amp;&lt;&gt;&quot;&#39;ąź/=');
  });
});
