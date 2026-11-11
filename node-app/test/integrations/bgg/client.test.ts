import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BggUnavailableError, createBggClient } from '../../../src/integrations/bgg/client.ts';
import type { BggClientOptions } from '../../../src/integrations/bgg/client.ts';

const searchXml = `<?xml version="1.0" encoding="utf-8"?>
<items total="3" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="13"><name type="primary" value="Catan"/><yearpublished value="1995"/></item>
  <item type="boardgame" id="27710"><name type="alternate" value="Die Siedler von Catan"/></item>
  <item type="boardgame" id="13"><name type="primary" value="Catan again"/></item>
  <item type="boardgame" id="0"><name type="primary" value="Broken"/></item>
</items>`;

const thingXml = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="174430">
    <thumbnail>
      https://cf.geekdo-images.com/thumb/img/gloomhaven.jpg
    </thumbnail>
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <name type="alternate" sortindex="1" value="Gloomhaven (Polish)"/>
    <name type="alternate" sortindex="1" value="GLOOMHAVEN"/>
    <name type="alternate" sortindex="1" value="Mroczna Przystań"/>
    <name type="alternate" sortindex="1" value="Mroczna Przystań"/>
    <yearpublished value="2017"/>
    <maxplayers value="4"/>
    <statistics page="1"><ratings><averageweight value="2.0488"/></ratings></statistics>
  </item>
</items>`;

const emptyXml = '<?xml version="1.0" encoding="utf-8"?><items total="0" termsofuse="x"></items>';

type Call = { url: string; init: RequestInit | undefined };

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/xml' } });
}

function mockFetch(handler: (url: string, call: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return handler(url, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

/** A fake clock: sleeping just moves the clock forward. */
function fakeClock() {
  const clock = {
    time: 0,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.time += ms;
    },
  };
  return clock;
}

function client(fetchFn: typeof fetch, extra: Partial<BggClientOptions> = {}) {
  const clock = fakeClock();
  return {
    clock,
    bgg: createBggClient({ token: ' secret ', fetch: fetchFn, sleep: clock.sleep, now: clock.now, ...extra }),
  };
}

const coverUrl = 'https://cf.geekdo-images.com/pic/cover.jpg';

function coverResponse(body: Uint8Array, headers: Record<string, string> = { 'content-type': 'image/jpeg' }) {
  return new Response(body, { status: 200, headers });
}

describe('search', () => {
  test('parses primary names and years, drops invalid and duplicate items', async () => {
    const { fn, calls } = mockFetch(() => xmlResponse(searchXml));
    const { bgg } = client(fn);
    const results = await bgg.search('  Catan & co! (x)  ');
    assert.deepEqual(results, [{ id: 13, name: 'Catan', year: 1995 }, { id: 27710, name: 'Die Siedler von Catan', year: null }]);
    assert.equal(calls[0]?.url, 'https://boardgamegeek.com/xmlapi2/search?query=Catan+%26+co%21+%28x%29&type=boardgame');
  });

  test('returns an empty list when nothing matches', async () => {
    const { bgg } = client(mockFetch(() => xmlResponse(emptyXml)).fn);
    assert.deepEqual(await bgg.search('zzz'), []);
  });
});

describe('getGame', () => {
  test('parses names, year, max players, exact weight and thumbnail', async () => {
    const { fn, calls } = mockFetch(() => xmlResponse(thingXml));
    const { bgg } = client(fn);
    const game = await bgg.getGame(174430);
    assert.deepEqual(game, {
      id: 174430,
      name: 'Gloomhaven',
      alternateNames: ['Gloomhaven (Polish)', 'Mroczna Przystań'],
      year: 2017,
      maxPlayers: 4,
      weight: '2.0488',
      thumbnailUrl: 'https://cf.geekdo-images.com/thumb/img/gloomhaven.jpg',
    });
    assert.equal(calls[0]?.url, 'https://boardgamegeek.com/xmlapi2/thing?id=174430&stats=1');
  });

  test('uses defaults for missing year, players, weight and thumbnail', async () => {
    const xml = '<items><item type="boardgame" id="5"><name type="primary" value="Bare"/></item></items>';
    const { bgg } = client(mockFetch(() => xmlResponse(xml)).fn);
    assert.deepEqual(await bgg.getGame(5), {
      id: 5, name: 'Bare', alternateNames: [], year: null, maxPlayers: 0, weight: '0', thumbnailUrl: null,
    });
  });

  test('returns null when BGG has no such item or no primary name', async () => {
    const { bgg } = client(mockFetch(() => xmlResponse(emptyXml)).fn);
    assert.equal(await bgg.getGame(999999), null);
    const noPrimary = '<items><item id="5"><name type="alternate" value="X"/></item></items>';
    const other = client(mockFetch(() => xmlResponse(noPrimary)).fn).bgg;
    assert.equal(await other.getGame(5), null);
  });
});

describe('configuration and authorization', () => {
  test('isConfigured reflects the token', () => {
    assert.equal(createBggClient({ token: null }).isConfigured, false);
    assert.equal(createBggClient({ token: '  ' }).isConfigured, false);
    assert.equal(createBggClient({ token: 'x' }).isConfigured, true);
  });

  test('API calls fail without a token and never hit the network', async () => {
    const { fn, calls } = mockFetch(() => xmlResponse(emptyXml));
    const bgg = createBggClient({ token: null, fetch: fn });
    await assert.rejects(bgg.search('a'), BggUnavailableError);
    assert.equal(calls.length, 0);
  });

  test('API calls send the trimmed Bearer token, cover downloads do not', async () => {
    const { fn, calls } = mockFetch((url) => (url.includes('geekdo-images') ? coverResponse(new Uint8Array([1])) : xmlResponse(emptyXml)));
    const { bgg } = client(fn);
    await bgg.search('a');
    await bgg.downloadCover(coverUrl);
    assert.deepEqual(calls[0]?.init?.headers, { Authorization: 'Bearer secret' });
    assert.equal(calls[1]?.init?.headers, undefined);
  });
});

describe('errors', () => {
  test('network error becomes BggUnavailableError', async () => {
    const { bgg } = client(mockFetch(() => { throw new TypeError('fetch failed'); }).fn);
    await assert.rejects(bgg.search('a'), BggUnavailableError);
  });

  test('non-OK status (including the queued 202) becomes BggUnavailableError', async () => {
    for (const status of [202, 401, 429, 503]) {
      const { bgg } = client(mockFetch(() => xmlResponse('', status)).fn);
      await assert.rejects(bgg.getGame(1), BggUnavailableError, `status ${status}`);
    }
  });

  test('unreadable XML becomes BggUnavailableError', async () => {
    for (const body of ['', 'not xml at all', '<items><item></items>']) {
      const { bgg } = client(mockFetch(() => xmlResponse(body)).fn);
      await assert.rejects(bgg.search('a'), BggUnavailableError, JSON.stringify(body));
    }
  });
});

describe('throttling', () => {
  test('a second concurrent call waits for the minimum interval', async () => {
    const { fn, calls } = mockFetch(() => xmlResponse(emptyXml));
    const { bgg, clock } = client(fn, { minIntervalMs: 5000 });
    await Promise.all([bgg.search('a'), bgg.search('b')]);
    assert.equal(calls.length, 2);
    assert.deepEqual(clock.sleeps, [5000]);
  });

  test('a later call only waits for the remainder of the interval', async () => {
    const { fn } = mockFetch(() => xmlResponse(emptyXml));
    const { bgg, clock } = client(fn, { minIntervalMs: 5000 });
    await bgg.search('a');
    clock.time += 2000;
    await bgg.search('b');
    assert.deepEqual(clock.sleeps, [3000]);
  });

  test('calls run one at a time, in order', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const { fn } = mockFetch(async (url) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(url);
      await new Promise((resolve) => setImmediate(resolve));
      running--;
      return xmlResponse(emptyXml);
    });
    const { bgg } = client(fn);
    await Promise.all([bgg.search('a'), bgg.search('b'), bgg.search('c')]);
    assert.equal(maxRunning, 1);
    assert.deepEqual(order.map((u) => u.slice(-22)), ['query=a&type=boardgame', 'query=b&type=boardgame', 'query=c&type=boardgame']);
  });

  test('a failed request does not block the queue', async () => {
    const { fn } = mockFetch((_url, call) => (call === 1 ? xmlResponse('', 500) : xmlResponse(searchXml)));
    const { bgg, clock } = client(fn);
    const first = bgg.search('a');
    const second = bgg.search('b');
    await assert.rejects(first, BggUnavailableError);
    assert.equal((await second).length, 2);
    assert.deepEqual(clock.sleeps, [5000]);
  });
});

describe('downloadCover', () => {
  test('returns bytes and a normalised content type for a valid cover', async () => {
    const { bgg } = client(mockFetch(() => coverResponse(new Uint8Array([1, 2, 3]), { 'content-type': 'image/PNG; charset=x' })).fn);
    const cover = await bgg.downloadCover(coverUrl);
    assert.equal(cover?.contentType, 'image/png');
    assert.deepEqual([...(cover?.bytes ?? [])], [1, 2, 3]);
  });

  test('rejects the wrong host, http and garbage without fetching', async () => {
    const { fn, calls } = mockFetch(() => coverResponse(new Uint8Array([1])));
    const { bgg } = client(fn);
    for (const url of [
      'https://example.com/cover.jpg',
      'https://geekdo-images.com/cover.jpg',
      'https://cf.geekdo-images.com.evil.com/cover.jpg',
      'http://cf.geekdo-images.com/cover.jpg',
      'not a url',
    ]) {
      assert.equal(await bgg.downloadCover(url), null, url);
    }
    assert.equal(calls.length, 0);
  });

  test('rejects a wrong content type, a bad status, an empty body and a network error', async () => {
    const bytes = new Uint8Array([1]);
    const cases: Array<() => Response> = [
      () => coverResponse(bytes, { 'content-type': 'text/html' }),
      () => coverResponse(bytes, {}),
      () => new Response(bytes, { status: 404, headers: { 'content-type': 'image/jpeg' } }),
      () => coverResponse(new Uint8Array(0)),
      () => { throw new TypeError('fetch failed'); },
    ];
    for (const make of cases) {
      const { bgg } = client(mockFetch(make).fn);
      assert.equal(await bgg.downloadCover(coverUrl), null);
    }
  });

  test('rejects a cover over 2 MB by Content-Length', async () => {
    const headers = { 'content-type': 'image/jpeg', 'content-length': String(2 * 1024 * 1024 + 1) };
    const { bgg } = client(mockFetch(() => coverResponse(new Uint8Array(10), headers)).fn);
    assert.equal(await bgg.downloadCover(coverUrl), null);
  });

  test('rejects a cover over 2 MB by the bytes actually read, and accepts exactly 2 MB', async () => {
    const limit = 2 * 1024 * 1024;
    const tooBig = client(mockFetch(() => coverResponse(new Uint8Array(limit + 1))).fn).bgg;
    assert.equal(await tooBig.downloadCover(coverUrl), null);
    const exact = client(mockFetch(() => coverResponse(new Uint8Array(limit))).fn).bgg;
    assert.equal((await exact.downloadCover(coverUrl))?.bytes.length, limit);
  });
});
