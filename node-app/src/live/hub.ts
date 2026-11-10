// Live board updates over WebSocket – new compared with the .NET app, where other users saw changes only after
// a reload (Blazor's SignalR connection only re-rendered the user's own page).
//
// Design ("notify, then fetch", proposal 5b): after any change the server sends every open page a tiny message
//   { "type": "board", "version": 42, "tableId": 7, "boot": "…" }   (tableId null = rows added or removed)
// with no user data in it. Each page then fetches the changed row (or all rows) over normal HTTP, with its own
// cookie, so it gets exactly the controls its viewer may use. `version` counts changes: a page that sees a gap
// (it missed messages while disconnected) fetches everything. `boot` changes when the server restarts (the
// counter starts again), which also means "fetch everything".
// See docs/learning/live-updates.md.

import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';

export type BoardChange = { tableId: number | null };

export type LiveHub = {
  /** Current board version: increases by one with every change. */
  readonly version: number;
  readonly bootId: string;
  /** Tells every open page that the board changed. */
  notify(change: BoardChange): void;
  /** Number of open connections (for tests and logs). */
  readonly connections: number;
};

export function createLiveHub(): LiveHub & { add(socket: WebSocket): void } {
  const sockets = new Set<WebSocket>();
  const bootId = randomUUID();
  let version = 0;

  return {
    get version() { return version; },
    bootId,
    get connections() { return sockets.size; },
    notify(change) {
      version++;
      const message = JSON.stringify({ type: 'board', version, tableId: change.tableId, boot: bootId });
      for (const socket of sockets) {
        // 1 = OPEN. A socket that is closing is skipped; its 'close' event removes it.
        if (socket.readyState === 1) {
          socket.send(message);
        }
      }
    },
    add(socket) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.send(JSON.stringify({ type: 'hello', version, boot: bootId }));
    },
  };
}

/**
 * Registers GET /live (upgraded to a WebSocket). Anyone may listen – logged out visitors see the board too, and
 * the messages carry nothing private. Pages from other sites are refused: browsers send cookies with WebSocket
 * connections too, and don't apply CORS to them, so the Origin header is checked by hand ("cross-site WebSocket
 * hijacking"). Messages from the browser are ignored; every change goes through the HTTP routes and their checks.
 */
export async function registerLive(app: FastifyInstance, hub: ReturnType<typeof createLiveHub>, publicUrl: string): Promise<void> {
  const publicHost = new URL(publicUrl).host;
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.get('/live', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = null;
    }
    if (originHost === null || (originHost !== request.host && originHost !== publicHost)) {
      // 1008 = policy violation.
      socket.close(1008, 'origin');
      return;
    }
    hub.add(socket);

    // A ping every 30 s keeps proxies from closing an idle connection and finds dead ones.
    let alive = true;
    socket.on('pong', () => { alive = true; });
    const timer = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('close', () => clearInterval(timer));
  });
}
