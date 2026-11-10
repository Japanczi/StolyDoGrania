// Feedback box: the round 💬 bubble on every page (logged-in users only) and the folder of saved comments.
// Port of Components/Layout/FeedbackBox.razor and Data/FeedbackArchive.cs.
//
// One .md file per comment, so saves never share a file. The file format (name pattern, front matter) must stay
// identical to the .NET app: the "review latest feedback" workflow reads these files.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { shortName } from '../domain/user-name.ts';
import { html, type SafeHtml } from '../web/html.ts';
import { createZip } from './zip.ts';

export const feedbackMaxLength = 4000;
const anonymous = '(niezalogowany)';
const pageMaxLength = 500;

// ---------- the box (HTML) ----------

/** The bubble + card. Renders nothing for anonymous users. The card starts hidden; public/js/feedback.js drives it. */
export function feedbackBox(request: FastifyRequest): SafeHtml {
  if (!request.user) {
    return html``;
  }
  return html`<div id="feedback-box" data-max="${feedbackMaxLength}">
    <section id="feedback-card" class="feedback-card" aria-label="Uwagi do strony" hidden>
        <div class="feedback-head">
            <strong>Masz uwagę?</strong>
            <button type="button" class="btn-close btn-close-sm" id="feedback-close" aria-label="Zamknij"></button>
        </div>
        <p class="feedback-hint">Napisz, co poprawić na tej stronie.</p>
        <textarea id="feedback-text" class="form-control form-control-sm" rows="4" maxlength="${feedbackMaxLength}" aria-label="Treść uwagi" placeholder="Twoja uwaga…"></textarea>
        <div class="feedback-foot">
            <span class="feedback-count" id="feedback-count">0/${feedbackMaxLength}</span>
            <button type="button" class="btn btn-success btn-sm" id="feedback-send" disabled>Wyślij</button>
        </div>
        <div class="feedback-status" id="feedback-status" role="status" hidden></div>
    </section>
    <button type="button" class="feedback-bubble" id="feedback-bubble" aria-label="Zgłoś uwagę" title="Zgłoś uwagę" aria-expanded="false" aria-controls="feedback-card">💬</button>
</div>`;
}

// ---------- the folder ----------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "yyyyMMdd-HHmmss" in the server's local time (like DateTime.Now.ToString in the .NET app). */
function stamp(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function listComments(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(dir, entry.name))
      .sort();
  } catch {
    return []; // folder doesn't exist yet
  }
}

/** Number of saved comments. */
export function countFeedback(dir: string): number {
  return listComments(dir).length;
}

export type PackedFeedback = {
  /** Suggested name of the downloaded zip. */
  fileName: string;
  bytes: Buffer;
  /** Full paths of the comment files inside the zip (pass them to deleteFeedback after the download). */
  files: string[];
};

/**
 * Zips every comment saved so far. Returns null when there are none.
 * The listed files are the ones in the zip, so comments saved meanwhile aren't deleted unseen.
 */
export function packFeedback(dir: string, now: Date): PackedFeedback | null {
  const files = listComments(dir);
  if (files.length === 0) {
    return null;
  }
  const entries = files.map(file => ({
    name: file.slice(dir.length).replace(/^[\\/]+/, ''),
    data: readFileSync(file),
    modified: statSync(file).mtime,
  }));
  return { fileName: `uwagi-${stamp(now)}.zip`, bytes: createZip(entries), files };
}

/** Deletes the given comment files; ones already gone are skipped. */
export function deleteFeedback(files: readonly string[]): void {
  for (const file of files) {
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

// ---------- saving a comment ----------

/** One header value on one line (a newline in a value could otherwise inject extra front matter keys). */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f]+/g, ' ').trim();
}

export type CommentAuthor = { userId: string; userName: string };

/**
 * Writes one comment file. `message` must already be validated. Same content as the .NET app:
 * front matter (date, page, user = short name, userName = full user name, userId), blank line, the trimmed text.
 * Lines end with "\n" (the .NET raw string used the source file's line endings, which are LF in git).
 */
export function saveComment(
  dir: string, author: CommentAuthor, page: string, message: string, now: Date = new Date(),
): { fileName: string } {
  const short = oneLine(shortName(author.userName));
  const fullName = oneLine(author.userName);
  const userId = oneLine(author.userId);
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const fileName = `${stamp(now)}-${randomBytes(3).toString('hex')}.md`;
  const content = [
    '---',
    `date: ${date}`,
    `page: ${page}`,
    `user: ${short.length > 0 ? short : anonymous}`,
    `userName: ${fullName.length > 0 ? fullName : anonymous}`,
    `userId: ${userId.length > 0 ? userId : anonymous}`,
    '---',
    '',
    message.trim(),
    '',
  ].join('\n');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content, 'utf8');
  return { fileName };
}

/** The page path sent by the browser: must be a single-line site path; anything else becomes "/". */
export function cleanPage(value: unknown): string {
  if (typeof value !== 'string') {
    return '/';
  }
  const page = oneLine(value).slice(0, pageMaxLength);
  return page.startsWith('/') && !page.startsWith('//') ? page : '/';
}

// ---------- route ----------

export function feedbackRoutes(app: FastifyInstance, deps: { dir: string }): void {
  /** Body: { message, page }. Answers { ok, message | error } like the board's JSON actions. */
  app.post('/api/feedback', async (request, reply) => {
    // Server-side check: anonymous visitors never get to write a file.
    const user = request.user;
    if (!user) {
      return reply.code(401).send({ ok: false, error: 'Zaloguj się, aby wysłać uwagę.' });
    }
    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message : '';
    if (message.trim().length === 0) {
      return reply.code(400).send({ ok: false, error: 'Wpisz treść uwagi.' });
    }
    if (message.length > feedbackMaxLength) {
      return reply.code(400).send({ ok: false, error: `Uwaga jest za długa (maks. ${feedbackMaxLength} znaków).` });
    }
    const now = new Date();
    try {
      saveComment(deps.dir, { userId: user.id, userName: user.userName }, cleanPage(body.page), message, now);
      return { ok: true, message: `Dziękujemy! Uwaga zapisana o ${pad(now.getHours())}:${pad(now.getMinutes())}.` };
    } catch (error) {
      request.log.error(error, 'Saving feedback failed');
      return reply.code(500).send({ ok: false, error: 'Nie udało się zapisać uwagi. Spróbuj ponownie.' });
    }
  });
}
