import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

import { GeminiLiveBridge } from '../ai/geminiLiveBridge.js';
import { env } from '../config/env.js';

const clients = new Map();

function safeSend(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function broadcast(payload, excludeClientId = null) {
  for (const [clientId, socket] of clients.entries()) {
    if (excludeClientId && clientId === excludeClientId) {
      continue;
    }

    const sent = safeSend(socket, payload);
    if (!sent) {
      clients.delete(clientId);
    }
  }
}

export async function socketRoutes(fastify) {
  fastify.get('/ws/live', { websocket: true }, (socket, request) => {
    const clientId = randomUUID();
    let liveBridge = null;
    let audioChunkCount = 0;
    let sessionStartedAt = null;

    clients.set(clientId, socket);

    safeSend(socket, {
      type: 'connected',
      clientId,
      mode: 'live_voice',
      message: 'Connected to Coachlix live voice gateway'
    });

    broadcast(
      {
        type: 'presence',
        onlineUsers: clients.size,
        joinedClientId: clientId
      },
      clientId
    );

    socket.on('message', async (rawData) => {
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

      try {
        if (parsed.type === 'start_session') {
          if (!env.geminiApiKey) {
            safeSend(socket, {
              type: 'error',
              message: 'Missing GEMINI_API_KEY in backend environment'
            });
            return;
          }

          if (!liveBridge) {
            liveBridge = new GeminiLiveBridge({
              fastify,
              clientId,
              onServerEvent: (eventPayload) => {
                safeSend(socket, eventPayload);
              }
            });
          }

          await liveBridge.connect({
            systemInstruction: parsed.systemInstruction,
            voiceName: parsed.voiceName,
            responseModalities: parsed.responseModalities
          });

          sessionStartedAt = Date.now();
          audioChunkCount = 0;

          fastify.log.info(
            {
              clientId,
              model: env.geminiLiveModel,
              apiVersion: env.geminiApiVersion,
              responseModalities: parsed.responseModalities || ['AUDIO']
            },
            'Live session started'
          );

          safeSend(socket, {
            type: 'session_started',
            model: env.geminiLiveModel,
            voiceName: parsed.voiceName || env.geminiVoiceName
          });

          return;
        }

        if (parsed.type === 'audio_chunk') {
          if (!liveBridge) {
            safeSend(socket, {
              type: 'error',
              message: 'Session not started. Send start_session first.'
            });
            return;
          }

          await liveBridge.sendAudioChunk({
            audioBase64: parsed.audio,
            mimeType: parsed.mimeType
          });

          audioChunkCount += 1;
          if (audioChunkCount % 50 === 0) {
            fastify.log.info(
              {
                clientId,
                audioChunkCount,
                mimeType: parsed.mimeType || env.audioInputMimeType
              },
              'Live audio stream progressing'
            );
          }

          return;
        }

        if (parsed.type === 'text_input') {
          if (!liveBridge) {
            safeSend(socket, {
              type: 'error',
              message: 'Session not started. Send start_session first.'
            });
            return;
          }

          await liveBridge.sendTextInput(parsed.text || '', parsed.turnComplete ?? true);
          return;
        }

        if (parsed.type === 'end_turn') {
          if (!liveBridge) {
            safeSend(socket, {
              type: 'error',
              message: 'Session not started. Send start_session first.'
            });
            return;
          }

          await liveBridge.markEndOfTurn();

          fastify.log.info(
            {
              clientId,
              audioChunkCount,
              elapsedMs: sessionStartedAt ? Date.now() - sessionStartedAt : null
            },
            'Live end_turn received'
          );

          return;
        }

        if (parsed.type === 'stop_session') {
          if (liveBridge) {
            await liveBridge.close();
            liveBridge = null;
          }

          fastify.log.info(
            {
              clientId,
              audioChunkCount,
              elapsedMs: sessionStartedAt ? Date.now() - sessionStartedAt : null
            },
            'Live session stopped'
          );

          safeSend(socket, { type: 'session_stopped' });
          return;
        }

        safeSend(socket, {
          type: 'error',
          message: `Unknown event type: ${parsed.type || 'undefined'}`
        });
      } catch (error) {
        fastify.log.error({ error, clientId }, 'Live WS event handling failed');
        safeSend(socket, {
          type: 'error',
          message: error?.message || 'Live event handling failed'
        });
      }
    });

    socket.on('close', async () => {
      if (liveBridge) {
        try {
          await liveBridge.close();
        } catch (error) {
          fastify.log.error({ error, clientId }, 'Failed closing live bridge');
        }
      }

      clients.delete(clientId);

      fastify.log.info(
        {
          clientId,
          audioChunkCount,
          elapsedMs: sessionStartedAt ? Date.now() - sessionStartedAt : null
        },
        'Live websocket closed'
      );

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
      'Live WebSocket client connected'
    );
  });

  fastify.get('/ws/stats', async () => ({
    onlineUsers: clients.size
  }));
}
