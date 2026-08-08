// chatWsServer.js
// Standalone chat WebSocket server built directly on the `ws` library and
// attached to the underlying HTTP server. This bypasses @fastify/websocket
// and gives us reliable, dependency-light control over the /ws/chat upgrade,
// heartbeat, and framing — which is what works most consistently behind
// Render's proxy for real-time token streaming.

import { WebSocketServer, WebSocket } from 'ws';
import { verifyUserToken } from '../shared/auth.js';
import { chatService } from '../module/chat/chatService.js';

// Under Render's ~55-100s default idle timeout. Pings keep the connection
// alive AND let us detect dead peers quickly.
const CHAT_HEARTBEAT_MS = 25_000;

/**
 * Create a `noServer` WebSocketServer for /ws/chat and attach an `upgrade`
 * listener to the Fastify HTTP server. Call this AFTER `fastify.listen()` so
 * `fastify.server` is the live HTTP server.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @returns {WebSocketServer}
 */
export function attachChatWebSocketServer(fastify) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket, request) => {
    let heartbeat = null;
    let alive = true;
    let inFlight = false;
    let user = null;

    const cleanup = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      inFlight = false;
    };

    const send = (payload) => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(payload));
        } catch (_) {
          // ignore send failures; handled by close/error
        }
      }
    };

    // Authenticate ONCE at handshake (token verified in the upgrade handler).
    user = request.chatUser || null;

    // Heartbeat: ping every interval, terminate if no pong comes back.
    heartbeat = setInterval(() => {
      if (!alive) {
        cleanup();
        return socket.terminate();
      }
      alive = false;
      try {
        socket.ping();
      } catch (_) {
        cleanup();
        socket.terminate();
      }
    }, CHAT_HEARTBEAT_MS);
    socket.on('pong', () => {
      alive = true;
    });

    socket.on('message', async (rawData) => {
      let data;
      try {
        data = JSON.parse(String(rawData));
      } catch (_) {
        send({ type: 'error', message: 'Invalid JSON payload' });
        return;
      }

      if (data.type === 'ping') {
        alive = true;
        send({ type: 'pong', ts: Date.now() });
        return;
      }

      if (data.type !== 'chat.message') {
        return;
      }

      if (inFlight) {
        send({ type: 'error', message: 'A message is already streaming. Wait for completion.' });
        return;
      }

      const { message, plan, chatId, files } = data || {};
      if (!message || !String(message).trim()) {
        send({ type: 'error', message: 'Message is required' });
        return;
      }

      inFlight = true;
      try {
        const result = await chatService.streamMessage(
          user.uid,
          { message, plan, chatId, files },
          (chunk) => {
            if (chunk?.type === 'thought_chunk') {
              send({ type: 'thought_chunk', text: chunk.text });
              return;
            }
            send({
              type: 'word',
              word: chunk?.word ?? chunk?.text ?? '',
              partialResponse: chunk?.partialResponse,
              isComplete: false,
            });
          },
          (event) => {
            if (!event?.type) return;
            const { type: eventType, ...eventFields } = event;
            send({ type: 'ai_event', event: eventType, ...eventFields });
          }
        );

        send({
          type: 'complete',
          fullResponse: result.response,
          suggestions: [],
          metadata: result.metadata,
          chatId: result.chatId,
        });
      } catch (err) {
        fastify.log.error({ err, userId: user?.uid }, 'WS chat streaming failed');
        send({ type: 'error', message: err?.message || 'Unexpected streaming error occurred.' });
      } finally {
        inFlight = false;
      }
    });

    socket.on('close', cleanup);
    socket.on('error', cleanup);

    send({ type: 'connected', mode: 'chat', message: 'Chat socket connected' });
    fastify.log.info({ userId: user?.uid, ip: request.ip }, 'Chat WebSocket connected');
  });

  // Handle the HTTP upgrade for /ws/chat. `fastify.server` is the live HTTP
  // server (available after fastify.listen()). We use `noServer: true` and
  // match the path ourselves so @fastify/websocket (used for /ws/live) and
  // this server never fight over the same route.
  fastify.server.on('upgrade', (request, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(request.url || '', 'http://localhost').pathname;
    } catch (_) {
      pathname = String(request.url || '').split('?')[0];
    }

    if (pathname !== '/ws/chat') {
      return; // let @fastify/websocket handle /ws/live etc.
    }

    // Authenticate at handshake, then complete the upgrade.
    const token = (() => {
      try {
        const qs = new URL(request.url || '', 'http://localhost').searchParams;
        return String(qs.get('token') || '').trim();
      } catch (_) {
        return String(request.url || '')
          .split('?')[1]
          ?.split('&')
          .find((p) => p.startsWith('token='))
          ?.slice(6) || '';
      }
    })();

    verifyUserToken(token)
      .then((verifiedUser) => {
        if (!verifiedUser?.uid) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        request.chatUser = verifiedUser;
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      });
  });

  fastify.log.info('Standalone /ws/chat WebSocket server attached (ws library)');

  return wss;
}
