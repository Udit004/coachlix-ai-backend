import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';

import { env } from '../config/env.js';

export async function registerCorePlugins(fastify) {
  await fastify.register(sensible);

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  await fastify.register(cors, {
    origin: [env.frontendOrigin],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  });

  await fastify.register(websocket, {
    options: {
      clientTracking: true
    }
  });
}
