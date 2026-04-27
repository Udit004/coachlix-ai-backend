import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const clients = new Map();

function safeSend(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(payload, excludeClientId = null) {
  for (const [clientId, socket] of clients.entries()) {
    if (excludeClientId && clientId === excludeClientId) {
      continue;
    }
    safeSend(socket, payload);
  }
}

export async function socketRoutes(fastify) {
  fastify.get('/ws', { websocket: true }, (connection, request) => {
    const clientId = randomUUID();
    const { socket } = connection;

    clients.set(clientId, socket);

    safeSend(socket, {
      type: 'connected',
      clientId,
      message: 'Connected to Coachlix WS server'
    });

    broadcast(
      {
        type: 'presence',
        onlineUsers: clients.size,
        joinedClientId: clientId
      },
      clientId
    );

    socket.on('message', (rawData) => {
      const data = String(rawData);
      let parsed;

      try {
        parsed = JSON.parse(data);
      } catch {
        safeSend(socket, {
          type: 'error',
          message: 'Invalid JSON payload'
        });
        return;
      }

      if (parsed.type === 'ping') {
        safeSend(socket, { type: 'pong', ts: Date.now() });
        return;
      }

      if (parsed.type === 'broadcast') {
        broadcast({
          type: 'broadcast',
          from: clientId,
          payload: parsed.payload ?? null,
          ts: Date.now()
        });
        return;
      }

      safeSend(socket, {
        type: 'echo',
        from: clientId,
        payload: parsed,
        ts: Date.now()
      });
    });

    socket.on('close', () => {
      clients.delete(clientId);
      broadcast({
        type: 'presence',
        onlineUsers: clients.size,
        leftClientId: clientId
      });
    });

    socket.on('error', (error) => {
      fastify.log.error({ error, clientId }, 'WebSocket client error');
    });

    fastify.log.info(
      { clientId, ip: request.ip, totalClients: clients.size },
      'WebSocket client connected'
    );
  });

  fastify.get('/ws/stats', async () => ({
    onlineUsers: clients.size
  }));
}
