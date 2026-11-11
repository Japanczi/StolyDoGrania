// Port of Data/Bgg/BggClient.cs (the ASP.NET Core app): a server-side client for the BGG XML API.
// Behaviour kept from the C# version: same URLs and query encoding, Bearer token only for the XML API
// (never for cover downloads), at least 5 seconds between XML requests shared by all callers, the cover
// host/type/size checks and the same parse rules. Differences: Node has one thread but calls interleave at
// every `await`, so the throttle is a promise queue instead of a SemaphoreSlim, and requests carry a timeout.
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type BggSearchResult = { id: number; name: string; year: number | null };

export type BggGameDetails = {
  id: number;
  name: string;
  alternateNames: string[];
  year: number | null;
  /** 0 = BGG doesn't state it */
  maxPlayers: number;
  /** BGG's average weight exactly as the XML gives it (e.g. "2.0488"), "0" when unrated or missing */
  weight: string;
  thumbnailUrl: string | null;
};

export type BggCover = { bytes: Buffer; contentType: string };

/** BGG couldn't be reached or refused the request (throttling, a bad token, an unreadable response). */
export class BggUnavailableError extends Error {}

export type BggClient = {
  /** True when a BGG token is present. */
  readonly isConfigured: boolean;
  /** Searches board games by name; BGG matches primary and alternate names alike. */
  search(query: string): Promise<BggSearchResult[]>;
  /** Resolves to null when BGG has no item with this id. */
  getGame(bggId: number): Promise<BggGameDetails | null>;
  /** Downloads a cover from BGG's image host. A cover is optional, so any failure resolves to null. */
  downloadCover(url: string): Promise<BggCover | null>;
};

export type BggClientOptions = {
  token: string | null;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Minimum spacing between XML API requests. Default 5000 (BGG's wiki: "a 5-second wait seems to suffice"). */
  minIntervalMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests (milliseconds, like Date.now). */
  now?: () => number;
  /** Per request timeout. Default 15000. */
  timeoutMs?: number;
};

const apiRoot = 'https://boardgamegeek.com/xmlapi2/';
const coverHostSuffix = '.geekdo-images.com';
const allowedCoverTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const maxCoverBytes = 2 * 1024 * 1024;

export function createBggClient(options: BggClientOptions): BggClient {
  const token = options.token?.trim() ?? '';
  const doFetch = options.fetch ?? fetch;
  const minIntervalMs = options.minIntervalMs ?? 5000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15000;

  // Throttle: every XML request runs after the previous one has settled (success or failure) and after
  // the minimum interval since that one ended.
  let queueTail: Promise<unknown> = Promise.resolve();
  let nextRequestAt = Number.NEGATIVE_INFINITY;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queueTail.then(async () => {
      const delay = nextRequestAt - now();
      if (delay > 0) await sleep(delay);
      try {
        return await task();
      } finally {
        nextRequestAt = now() + minIntervalMs;
      }
    });
    // A failed request must not block the ones behind it.
    queueTail = run.catch(() => undefined);
    return run;
  }

  async function getXml(relativeUrl: string): Promise<unknown> {
    if (token === '') throw new BggUnavailableError('Missing BGG token.');

    return enqueue(async () => {
      try {
        const response = await doFetch(apiRoot + relativeUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Anything else (401, 429, a throttling 500/503, a queued 202) leaves us without data.
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => undefined);
          throw new BggUnavailableError(`BGG answered with status ${response.status}.`);
        }
        const text = await response.text();
        const valid = XMLValidator.validate(text);
        if (valid !== true) throw new BggUnavailableError(`BGG sent unreadable XML: ${valid.err.msg}`);
        return xmlParser.parse(text);
      } catch (error) {
        if (error instanceof BggUnavailableError) throw error;
        throw new BggUnavailableError('BGG request failed.', { cause: error });
      }
    });
  }

  async function downloadCover(url: string): Promise<BggCover | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.toLowerCase().endsWith(coverHostSuffix)) return null;

    try {
      // No Authorization header: the token is only meant for the XML API.
      const response = await doFetch(parsed, { signal: AbortSignal.timeout(timeoutMs) });
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        !response.ok ||
        !contentType ||
        !allowedCoverTypes.has(contentType) ||
        (response.headers.has('content-length') && declaredLength > maxCoverBytes) ||
        !response.body
      ) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      // Count the bytes actually read, whatever Content-Length claimed.
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxCoverBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
      return total > 0 ? { bytes: Buffer.concat(chunks, total), contentType } : null;
    } catch {
      return null;
    }
  }

  return {
    isConfigured: token !== '',
    async search(query) {
      // Uri.EscapeDataString also escapes !'()*, which encodeURIComponent leaves alone; spaces become '+'.
      const encoded = encodeURIComponent(query.trim())
        .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .replaceAll('%20', '+');
      return parseSearchResults(await getXml(`search?query=${encoded}&type=boardgame`));
    },
    async getGame(bggId) {
      return parseGameDetails(await getXml(`thing?id=${bggId}&stats=1`));
    },
    downloadCover,
  };
}

// --- XML parsing -----------------------------------------------------------------------------------------

// Attribute values and text stay strings (weight must be kept exactly); <item> and <name> are always arrays.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (tagName) => tagName === 'item' || tagName === 'name',
});

type XmlNode = Record<string, unknown>;

function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first element called `name` below `parent` (as a node), or null. */
function child(parent: XmlNode, name: string): XmlNode | null {
  const value = parent[name];
  const first = Array.isArray(value) ? value[0] : value;
  return isNode(first) ? first : null;
}

function items(document: unknown): XmlNode[] {
  if (!isNode(document) || !isNode(document['items'])) return [];
  const list = document['items']['item'];
  return Array.isArray(list) ? list.filter(isNode) : [];
}

function attr(node: XmlNode | null, name: string): string | null {
  const value = node?.[`@_${name}`];
  return typeof value === 'string' ? value : null;
}

/** Like C# int.TryParse with NumberStyles.Integer: optional whitespace and sign, digits only. */
function parseInteger(text: string | null): number | null {
  if (text === null || !/^\s*[+-]?\d+\s*$/.test(text)) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && Math.abs(value) <= 2147483647 ? value : null;
}

function valueOf(item: XmlNode, childName: string): number | null {
  return parseInteger(attr(child(item, childName), 'value'));
}

function parseSearchResults(document: unknown): BggSearchResult[] {
  const results: BggSearchResult[] = [];
  const seen = new Set<number>();
  for (const item of items(document)) {
    const id = parseInteger(attr(item, 'id')) ?? 0;
    const name = attr(child(item, 'name'), 'value')?.trim() ?? '';
    if (id <= 0 || name.length === 0 || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, name, year: valueOf(item, 'yearpublished') });
  }
  return results;
}

function parseGameDetails(document: unknown): BggGameDetails | null {
  const item = items(document)[0];
  const id = item ? parseInteger(attr(item, 'id')) : null;
  if (!item || id === null) return null;

  const names = (Array.isArray(item['name']) ? item['name'].filter(isNode) : [])
    .map((n) => ({ type: attr(n, 'type'), value: attr(n, 'value')?.trim() ?? '' }))
    .filter((n) => n.value !== '');

  const primary = names.find((n) => n.type === 'primary')?.value;
  if (primary === undefined) return null;

  const alternateNames: string[] = [];
  const seenLower = new Set([primary.toLowerCase()]);
  for (const n of names) {
    if (n.type === 'primary' || seenLower.has(n.value.toLowerCase())) continue;
    seenLower.add(n.value.toLowerCase());
    alternateNames.push(n.value);
  }

  const ratings = child(child(item, 'statistics') ?? {}, 'ratings');
  const weightText = attr(child(ratings ?? {}, 'averageweight'), 'value')?.trim() ?? null;
  const weight = weightText !== null && weightText !== '' && Number.isFinite(Number(weightText)) ? weightText : '0';

  const thumbnailText = typeof item['thumbnail'] === 'string' ? item['thumbnail'].trim() : '';

  return {
    id,
    name: primary,
    alternateNames,
    year: valueOf(item, 'yearpublished'),
    maxPlayers: valueOf(item, 'maxplayers') ?? 0,
    weight,
    thumbnailUrl: URL.canParse(thumbnailText) ? thumbnailText : null,
  };
}
