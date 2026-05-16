import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';

import { env } from '../config/env.js';

export async function registerCorePlugins(fastify) {
  const allowedOrigins = String(env.frontendOrigin || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
    console.log('Allowed Origins:', allowedOrigins);

  await fastify.register(sensible);

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  // Hardcoded CORS for testing (localhost + deployed frontend)
  const hardcodedOrigins = [
    'http://localhost:3000',
    'https://coachlix-ai.vercel.app'
  ];

  console.log('Allowed Origins (hardcoded):', hardcodedOrigins);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || hardcodedOrigins.includes(origin)) {
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
