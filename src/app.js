import Fastify from 'fastify';

import { env } from './config/env.js';
import { registerCorePlugins } from './plugins/corePlugins.js';
import { apiRoutes } from './routes/apiRoutes.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { socketRoutes } from './sockets/socketRoutes.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: env.nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        env.nodeEnv === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname'
              }
            }
    }
  });

  await registerCorePlugins(fastify);

  await fastify.register(healthRoutes);
  await fastify.register(apiRoutes, { prefix: '/api/v1' });
  await fastify.register(socketRoutes);

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(
      { err: error, path: request.url, method: request.method },
      'Request failed'
    );

    if (!reply.sent) {
      reply.status(error.statusCode || 500).send({
        error: error.name || 'InternalServerError',
        message: error.message || 'Something went wrong'
      });
    }
  });

  return fastify;
}
