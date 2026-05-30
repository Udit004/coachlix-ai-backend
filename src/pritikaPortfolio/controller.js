import { env } from '../config/env.js';
import { generatePortfolioReply } from './service.js';

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const sendSseEvent = (reply, payload) => {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const parseAllowedOrigins = (value) =>
  String(value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const isAllowedOrigin = (origin, allowedOrigins) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return LOCAL_ORIGIN_PATTERN.test(origin);
};

const buildSseCorsHeaders = (request) => {
  const allowedOrigins = parseAllowedOrigins(env.frontendOrigin);
  const requestOrigin = request.headers.origin;
  const originAllowed = isAllowedOrigin(requestOrigin, allowedOrigins);

  return {
    'Access-Control-Allow-Origin':
      originAllowed && requestOrigin ? requestOrigin : allowedOrigins[0] || '*',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin'
  };
};

const chunkText = (text, maxChunkSize = 120) => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }

  const chunks = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChunkSize && current) {
      chunks.push(current);
      current = word;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

export function createPritikaPortfolioController() {
  return {
    streamChat: async (request, reply) => {
      try {
        const { message, context } = request.body || {};

        if (!message || !String(message).trim()) {
          return reply.code(400).send({
            success: false,
            message: 'message is required'
          });
        }

        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...buildSseCorsHeaders(request)
        });
        reply.raw.flushHeaders?.();

        sendSseEvent(reply, {
          type: 'connection',
          message: 'SSE connection established'
        });

        const result = await generatePortfolioReply({
          message: String(message).trim(),
          context: context || {}
        });

        const chunks = chunkText(result.text);

        for (const chunk of chunks) {
          sendSseEvent(reply, {
            type: 'delta',
            text: chunk,
            isComplete: false
          });
        }

        sendSseEvent(reply, {
          type: 'complete',
          text: result.text,
          model: result.model,
          promptSource: result.promptSource
        });

        reply.raw.end();
      } catch (error) {
        request.log?.error?.({ err: error }, 'Pritika portfolio stream failed');

        if (!reply.sent) {
          return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.message || 'Unable to stream response'
          });
        }

        try {
          sendSseEvent(reply, {
            type: 'error',
            message: error.message || 'Unexpected streaming error'
          });
        } finally {
          reply.raw.end();
        }
      }
    }
  };
}
