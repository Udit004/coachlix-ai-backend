import { buildServer } from './app.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { setupAIModule } from './services/aiIntegration.js';
import { initializeEventBus, closeEventBus } from './services/eventBus.js';
import { registerMemoryPromotionPipeline } from './services/memoryPromotionPipeline.js';
import { registerSummarizeWorker } from './services/summarizeWorker.js';

const start = async () => {
  const fastify = await buildServer();

  try {
    await connectMongo();
    await setupAIModule(env.geminiApiKey);
    await initializeEventBus(fastify);

    // Register background memory workers (off the hot request path).
    registerMemoryPromotionPipeline();
    registerSummarizeWorker();
    fastify.log.info('Long-term memory workers registered (promotion + summarizer)');

    await fastify.listen({
      host: env.host,
      port: env.port
    });

    fastify.log.info(
      `Coachlix backend is running at http://${env.host}:${env.port}`
    );

    const shutdown = async (signal) => {
      fastify.log.info({ signal }, 'Graceful shutdown started');
      await closeEventBus();
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
