import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';

import { env } from '../config/env.js';

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

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

export async function registerCorePlugins(fastify) {
  const allowedOrigins = parseAllowedOrigins(env.frontendOrigin);
    console.log('Allowed Origins:', allowedOrigins);

  await fastify.register(sensible);

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  // Hardcoded CORS for testing (localhost + deployed frontend)
  const hardcodedOrigins = [
    'http://localhost:3000',
    'https://coachlix-ai.vercel.app',
    'https://pritikakumari.vercel.app'
  ];

  console.log('Allowed Origins (hardcoded):', hardcodedOrigins);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin, [...allowedOrigins, ...hardcodedOrigins])) {
        cb(null, true);
        return;
      }

      cb(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Type', 'Cache-Control'],
    credentials: true
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024
    }
  });

  await fastify.register(websocket, {
    options: {
      clientTracking: true
    }
  });
}
