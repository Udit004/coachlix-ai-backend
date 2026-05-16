import { chatService } from './chatService.js';
import { verifyUserToken } from '../../shared/auth.js';
import { env } from '../../config/env.js';

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const sendSseEvent = (reply, payload) => {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const parseAllowedOrigins = (value) =>
  String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const isAllowedOrigin = (origin, allowedOrigins) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return LOCAL_ORIGIN_PATTERN.test(origin);
};

const getAllowedOrigins = () =>
  parseAllowedOrigins(env.frontendOrigin);

const buildSseCorsHeaders = (request) => {
  const requestOrigin = request.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  const originAllowed = isAllowedOrigin(requestOrigin, allowedOrigins);

  return {
    'Access-Control-Allow-Origin':
      originAllowed && requestOrigin ? requestOrigin : allowedOrigins[0] || '*',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
};

const verifyRequestUser = async (request) => {
  const authHeader =
    request.headers.authorization || request.headers.Authorization || '';

  if (!authHeader) {
    throw { statusCode: 401, message: 'Authorization header missing' };
  }

  try {
    return await verifyUserToken(authHeader);
  } catch (error) {
    throw {
      statusCode: 401,
      message: error.message || 'Invalid authorization token',
    };
  }
};

const wrap = (handler) => async (request, reply) => {
  try {
    request.user = await verifyRequestUser(request);

    const result = await handler(request, reply);
    if (reply.sent) {
      return reply;
    }

    if (result?.statusCode) {
      return reply.code(result.statusCode).send(result);
    }

    return result;
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';

    console.error('[Chat Controller] Error:', error);

    if (reply.sent) {
      return reply;
    }

    return reply.code(statusCode).send({
      success: false,
      message,
      error: error.toString(),
    });
  }
};

export const createChatController = () => ({
  processMessage: async (request, reply) => {
    try {
      request.user = await verifyRequestUser(request);
      const { message, plan, chatId, files } = request.body || {};

      if (!message) {
        return reply.code(400).send({
          success: false,
          message: 'Message is required',
        });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...buildSseCorsHeaders(request),
      });
      reply.raw.flushHeaders?.();

      sendSseEvent(reply, {
        type: 'connection',
        message: 'SSE connection established',
      });

      const result = await chatService.streamMessage(
        request.user.uid,
        { message, plan, chatId, files },
        async ({ text, partialResponse }) => {
          sendSseEvent(reply, {
            type: 'word',
            word: text,
            partialResponse,
            isComplete: false,
          });
        }
      );

      sendSseEvent(reply, {
        type: 'complete',
        fullResponse: result.response,
        suggestions: [],
        metadata: result.metadata,
        chatId: result.chatId,
      });

      reply.raw.end();
    } catch (error) {
      console.error('[Chat Controller] Streaming error:', error);

      if (!reply.sent) {
        return reply.code(error.statusCode || 500).send({
          success: false,
          message: error.message || 'Error processing message',
        });
      }

      try {
        sendSseEvent(reply, {
          type: 'error',
          error: error.message || 'Unexpected streaming error occurred.',
        });
      } finally {
        reply.raw.end();
      }
    }
  },

  getSession: wrap(async (request) => {
    const { chatId } = request.params;
    const session = await chatService.getChatSession(chatId);

    if (!session) {
      return {
        statusCode: 404,
        success: false,
        message: 'Chat session not found',
      };
    }

    return { success: true, session };
  }),

  getUserSessions: wrap(async (request) => {
    const { limit } = request.query;
    const result = await chatService.getUserSessions(
      request.user.uid,
      parseInt(limit, 10) || 20
    );

    return { success: true, ...result };
  }),

  createSession: wrap(async (request) => {
    const { title, plan, messages } = request.body || {};
    const session = await chatService.createSession(
      request.user.uid,
      title,
      plan,
      messages
    );

    return { success: true, session, statusCode: 201 };
  }),

  updateSession: wrap(async (request) => {
    const { chatId } = request.params;
    const session = await chatService.updateSession(chatId, request.user.uid, request.body || {});

    return { success: true, session };
  }),

  deleteSession: wrap(async (request) => {
    const { chatId } = request.params;
    const session = await chatService.deleteSession(chatId, request.user.uid);

    return { success: true, message: 'Chat session deleted', session };
  }),

  clearHistory: wrap(async (request) => {
    const { chatId } = request.params;
    const session = await chatService.clearHistory(chatId);

    return { success: true, message: 'Chat history cleared', session };
  }),
});
