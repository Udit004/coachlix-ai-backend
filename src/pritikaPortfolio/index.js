import { createPritikaPortfolioController } from './controller.js';

export async function registerPritikaPortfolioModule(fastify) {
  const controller = createPritikaPortfolioController();

  fastify.get('/health', async () => ({
    success: true,
    module: 'pritikaPortfolio'
  }));

  fastify.post('/chat/stream', controller.streamChat);
}
