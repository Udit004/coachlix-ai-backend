import { buildServer } from './app.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';

const start = async () => {
  const fastify = await buildServer();

  try {
    await connectMongo();

    await fastify.listen({
      host: env.host,
      port: env.port
    });

    fastify.log.info(
      `Coachlix backend is running at http://${env.host}:${env.port}`
    );

    const shutdown = async (signal) => {
      fastify.log.info({ signal }, 'Graceful shutdown started');
      await fastify.close();
      await disconnectMongo();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      shutdown('SIGINT').catch((error) => {
        fastify.log.error({ error }, 'Shutdown failed');
        process.exit(1);
      });
    });

    process.on('SIGTERM', () => {
      shutdown('SIGTERM').catch((error) => {
        fastify.log.error({ error }, 'Shutdown failed');
        process.exit(1);
      });
    });
  } catch (error) {
    fastify.log.error({ error }, 'Unable to start server');
    process.exit(1);
  }
};

start();
