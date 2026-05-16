import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';

import { env } from '../config/env.js';

export async function registerCorePlugins(fastify) {
  // Generic OPTIONS handler to prevent 404 on preflight requests when CORS is disabled
    fastify.options('/*', (request, reply) => {
      reply.code(204).send();
    });
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

  // await fastify.register(cors, {
  //   origin: (origin, cb) => {
  //     if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
  //       cb(null, true);
  //       return;
  //     }
  //
  //     cb(new Error(`Origin ${origin} is not allowed by CORS`), false);
  //   },
  //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  //   allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  //   exposedHeaders: ['Content-Type', 'Cache-Control'],
  //   credentials: true
  // });

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
