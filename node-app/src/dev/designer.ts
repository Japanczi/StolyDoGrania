// Backend of the page designer (public/tools/designer.js). Port of Tools/DesignerEndpoints.cs.
// Development only: it writes request data to the project folder, so the route is not even registered otherwise.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/** What the saved file's "file" answer shows (relative to the repository root, as in the .NET app). */
const designsFolderLabel = 'Claude_Resources/Tools/Designs';
const maxSlugLength = 60;
/** Kestrel's default request body limit was 30 MB; designs contain page snapshots, so Fastify's 1 MB is too small. */
const maxBodyBytes = 30 * 1024 * 1024;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Reduces a page path to a safe file name fragment, e.g. "/stoly?x=1" to "stoly-x-1". */
export function toSlug(page: string | null): string {
  let slug = (page ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > maxSlugLength) {
    slug = slug.slice(0, maxSlugLength).replace(/-+$/, '');
  }
  return slug.length === 0 ? 'root' : slug;
}

/** "yyyyMMdd-HHmmss-slug.json" in local time. */
export function designFileName(page: string | null, now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${toSlug(page)}.json`;
}

/**
 * Registers POST /_designer/save when `enabled` (Development). The JSON body parser only accepts
 * application/json, which together with the CSRF check keeps cross-site form posts out.
 * The file name is built from a timestamp and a slug of [a-z0-9-], so the request can't choose a path.
 */
export function designerRoutes(app: FastifyInstance, deps: { dir: string; enabled: boolean }): void {
  if (!deps.enabled) {
    return;
  }
  app.post('/_designer/save', { bodyLimit: maxBodyBytes }, async (request, reply) => {
    const design: unknown = request.body;
    const page = typeof design === 'object' && design !== null && 'page' in design && typeof design.page === 'string'
      ? design.page
      : null;
    const fileName = designFileName(page, new Date());
    try {
      mkdirSync(deps.dir, { recursive: true });
      // Local file, not HTML: JSON.stringify keeps Polish characters readable, indented like the .NET output.
      writeFileSync(join(deps.dir, fileName), JSON.stringify(design, null, 2), 'utf8');
    } catch (error) {
      request.log.error(error, 'Saving design failed');
      return reply.code(500).send({ title: 'Nie udało się zapisać projektu.', status: 500 });
    }
    return { file: `${designsFolderLabel}/${fileName}` };
  });
}
