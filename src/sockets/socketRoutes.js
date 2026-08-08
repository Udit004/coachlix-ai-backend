import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import mongoose from 'mongoose';

import { GeminiLiveBridge } from '../ai/geminiLiveBridge.js';
import { env } from '../config/env.js';
import { verifyUserToken } from '../shared/auth.js';
import { chatService } from '../module/chat/chatService.js';
import ChatSession from '../models/ChatSession.js';
import User from '../models/User.js';

// Persistent chat WebSocket heartbeat — under Render's ~55-100s idle timeout.
const CHAT_HEARTBEAT_MS = 25_000;

const clients = new Map();

const errorMessage = (err, fallback = 'Unknown error') => {
  if (!err) {
    return fallback;
  }

  if (typeof err?.message === 'string' && err.message.trim()) {
    return err.message;
  }

  if (typeof err === 'string' && err.trim()) {
    return err;
  }

  try {
    const serialized = JSON.stringify(err);
    return serialized && serialized !== '{}' ? serialized : fallback;
  } catch {
    return fallback;
  }
};

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

const normalizeUserId = (value, clientId) => {
  const trimmed = String(value || '').trim();
  return trimmed || `anon:${clientId}`;
};

const buildTitleFromMessage = (message) => {
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    return 'Live voice chat';
  }

  const snippet = trimmed.substring(0, 50);
  return snippet.length < 50 ? snippet : `${snippet}...`;
};

async function ensureChatSession({ userId, chatId, plan, title }) {
  if (chatId && mongoose.Types.ObjectId.isValid(chatId)) {
    const existing = await ChatSession.findById(chatId);
    if (existing) {
      return existing;
    }
  }

  const created = await ChatSession.create({
    userId,
    title: String(title || '').trim() || 'Live voice chat',
    plan: String(plan || '').trim() || 'general',
    messages: []
  });

  return created;
}

async function appendMessage(chatId, role, content, thought = null) {
  const trimmed = String(content || '').trim();
  const trimmedThought = thought ? String(thought).trim() : null;
  if (!chatId || !trimmed) {
    return null;
  }

  return ChatSession.findByIdAndUpdate(
    chatId,
    {
      $push: {
        messages: {
          role,
          content: trimmed,
          ...(trimmedThought ? { thoughtContent: trimmedThought } : {}),
          timestamp: new Date()
        }
      },
      $inc: { messageCount: 1 },
      $set: {
        lastMessage: trimmed.substring(0, 200),
        updatedAt: new Date()
      }
    },
    { new: true }
  );
}

export async function socketRoutes(fastify) {
  fastify.get('/ws/live', { websocket: true }, (socket, request) => {
    const clientId = randomUUID();
    let liveBridge = null;
    let audioChunkCount = 0;
    let sessionStartedAt = null;
    let userId = normalizeUserId('', clientId);
    let activeChatId = null;
    let activePlan = 'general';
    let pendingAiText = '';
    let pendingAiThought = '';

    const flushPendingAiText = async () => {
      if (!pendingAiText.trim() && !pendingAiThought.trim()) {
        return;
      }

      const textToPersist = pendingAiText;
      const thoughtToPersist = pendingAiThought;
      pendingAiText = '';
      pendingAiThought = '';
      await appendMessage(activeChatId, 'ai', textToPersist, thoughtToPersist);
    };

    const handleGeminiServerEvent = async (eventPayload) => {
      if (eventPayload?.type === 'gemini_text') {
        if (eventPayload.text) pendingAiText += eventPayload.text;
        if (eventPayload.thought) pendingAiThought += eventPayload.thought;
      }

      if (eventPayload?.type === 'gemini_turn_complete') {
        await flushPendingAiText();
      }
    };

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

          userId = normalizeUserId(parsed.userId, clientId);
          activePlan = String(parsed.plan || '').trim() || 'general';

          let chatSession;
          try {
            chatSession = await ensureChatSession({
              userId,
              chatId: parsed.chatId,
              plan: activePlan,
              title: parsed.title
            });
            activeChatId = chatSession._id.toString();
          } catch (err) {
            fastify.log.error(
              {
                err,
                clientId,
                userId,
                chatId: parsed.chatId || null,
                plan: activePlan
              },
              'Failed to initialize chat session in MongoDB'
            );

            safeSend(socket, {
              type: 'error',
              message: `Unable to initialize chat storage: ${errorMessage(err)}`
            });
            return;
          }

          if (!liveBridge) {
            liveBridge = new GeminiLiveBridge({
              fastify,
              clientId,
              userId,
              onServerEvent: (eventPayload) => {
                safeSend(socket, eventPayload);

                Promise.resolve(handleGeminiServerEvent(eventPayload)).catch(
                  (err) => {
                    fastify.log.error(
                      { err, clientId, activeChatId },
                      'Failed persisting Gemini server event'
                    );
                  }
                );
              }
            });
          }

          let userProfile = null;
          try {
            if (userId && !userId.startsWith('anon:')) {
              userProfile = await User.findOne({ firebaseUid: userId }).lean();
            }
          } catch (err) {
            fastify.log.error({ err, userId }, 'Failed to fetch user profile for live session memory');
          }

          let memoryContext = '';
          if (userProfile) {
            memoryContext += `\nUser Profile:\nName: ${userProfile.name || 'Unknown'}\nGoals: ${userProfile.fitnessGoal || 'Unknown'}\nExperience: ${userProfile.experience || 'Unknown'}\nAge: ${userProfile.age || 'Unknown'}, Weight: ${userProfile.weight || 'Unknown'}, Target Weight: ${userProfile.targetWeight || 'Unknown'}\n`;
          }

          if (chatSession && Array.isArray(chatSession.messages) && chatSession.messages.length > 0) {
            const recentMessages = chatSession.messages.slice(-15).map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`).join('\n');
            memoryContext += `\nRecent Conversation History:\n${recentMessages}\n`;
          }

          const baseInstruction = parsed.systemInstruction || env.liveSystemInstruction || '';
          const finalSystemInstruction = memoryContext 
            ? `${baseInstruction}\n\n--- CONTEXT ---\n${memoryContext}\nUse this context to remember the user's details and continue the conversation naturally. Do not explicitly state that you are reading from context, just act as if you remember them.` 
            : baseInstruction;

          try {
            await liveBridge.connect({
              systemInstruction: finalSystemInstruction,
              voiceName: parsed.voiceName,
              responseModalities: parsed.responseModalities
            });
          } catch (err) {
            fastify.log.error(
              {
                err,
                clientId,
                activeChatId,
                model: env.geminiLiveModel,
                apiVersion: env.geminiApiVersion
              },
              'Failed to connect Gemini live session'
            );

            safeSend(socket, {
              type: 'error',
              message: `Unable to start Gemini live session: ${errorMessage(err)}`
            });
            return;
          }

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
            voiceName: parsed.voiceName || env.geminiVoiceName,
            chatId: activeChatId,
            userId
          });

          return;
        }

        if (parsed.type === 'user_transcript') {
          const transcript = String(parsed.text || '').trim();
          const isFinal = parsed.isFinal !== false;

          if (isFinal && transcript) {
            const updatedChat = await appendMessage(activeChatId, 'user', transcript);

            if (updatedChat && updatedChat.title === 'Live voice chat') {
              updatedChat.title = buildTitleFromMessage(transcript);
              await updatedChat.save();
            }

            safeSend(socket, {
              type: 'chat_saved',
              chatId: activeChatId,
              role: 'user'
            });
          }

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

          if (parsed.text) {
            await appendMessage(activeChatId, 'user', parsed.text);
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

          await flushPendingAiText();

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
      } catch (err) {
        fastify.log.error(
          {
            err,
            clientId,
            eventType: parsed?.type || 'unknown'
          },
          'Live WS event handling failed'
        );
        safeSend(socket, {
          type: 'error',
          message: errorMessage(err, 'Live event handling failed')
        });
      }
    });

    socket.on('close', async () => {
      if (liveBridge) {
        try {
          await liveBridge.close();
          await flushPendingAiText();
        } catch (err) {
          fastify.log.error({ err, clientId }, 'Failed closing live bridge');
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

    socket.on('error', (err) => {
      fastify.log.error({ err, clientId }, 'WebSocket client error');
    });

fastify.log.info(
      { clientId, ip: request.ip, totalClients: clients.size },
      'Live WebSocket client connected'
    );
  });

  fastify.get('/ws/stats', async () => ({
    onlineUsers: clients.size
  }));

  // ── Chat WebSocket (text streaming) ─────────────────────────────────────
  // Uses @fastify/websocket (registered globally in corePlugins.js) so this
  // route is handled by the SAME upgrade handler as /ws/live — critical to
  // avoid the 404 that a second standalone `ws` upgrade listener caused.
  fastify.get('/ws/chat', { websocket: true }, (socket, request) => {
    const clientId = randomUUID();
    let userId = null;
    let inFlight = false;

    const send = (payload) => safeSend(socket, payload);

    const heartbeat = () => {
      if (socket.isAlive === false) {
        try {
          socket.terminate();
        } catch {
          // No-op
        }
        return;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        // No-op
      }
    };

    socket.isAlive = true;
    const heartbeatTimer = setInterval(heartbeat, CHAT_HEARTBEAT_MS);

    const onPong = () => {
      socket.isAlive = true;
    };
    socket.on('pong', onPong);

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      socket.off('pong', onPong);
    };

    // Authenticate at handshake-time via ?token= query param.
    const token = request.query?.token || request.query?.Token || '';
    verifyUserToken(String(token))
      .then((decoded) => {
        userId = decoded?.uid || null;
        if (!userId) {
          throw new Error('No uid in token');
        }
        fastify.log.info({ userId }, 'Chat WebSocket connected');
        send({ type: 'connected', message: 'Chat WebSocket connected' });
      })
      .catch((err) => {
        fastify.log.warn({ err: err?.message }, 'Chat WS auth failed');
        send({ type: 'error', message: 'Unauthorized' });
        cleanup();
        try {
          socket.close(4001, 'Unauthorized');
        } catch {
          socket.terminate();
        }
      });

    socket.on('message', async (rawData) => {
      if (!userId || inFlight) return;

      let data;
      try {
        data = JSON.parse(String(rawData));
      } catch {
        send({ type: 'error', message: 'Invalid JSON payload' });
        return;
      }

      if (data.type === 'ping') {
        send({ type: 'pong', ts: Date.now() });
        return;
      }

      if (data.type !== 'chat.message') {
        send({ type: 'error', message: `Unsupported type: ${data.type}` });
        return;
      }

      inFlight = true;
      try {
        const result = await chatService.streamMessage(
          userId,
          {
            message: data.message,
            plan: data.plan || 'general',
            chatId: data.chatId,
            files: data.files,
          },
          async (chunkData) => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            if (chunkData.type === 'thought_chunk') {
              send({ type: 'thought_chunk', text: chunkData.text });
              return;
            }
            send({
              type: 'word',
              word: chunkData.word ?? chunkData.text ?? '',
              partialResponse: chunkData.partialResponse,
              isComplete: false,
            });
          },
          async (event) => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            if (!event?.type) return;
            const { type: eventType, ...eventFields } = event;
            send({ type: 'ai_event', event: eventType, ...eventFields });
          }
        );

        send({
          type: 'complete',
          fullResponse: result.response,
          chatId: result.chatId,
          metadata: result.metadata,
        });
      } catch (err) {
        fastify.log.error({ err: err?.message, userId }, 'Chat WS stream error');
        send({ type: 'error', message: err?.message || 'Streaming error' });
      } finally {
        inFlight = false;
      }
    });

    socket.on('close', cleanup);
    socket.on('error', (err) => {
      fastify.log.error({ err: err?.message, clientId }, 'Chat WS client error');
    });
  });
}
