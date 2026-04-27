export async function healthRoutes(fastify) {
  fastify.get('/', async () => ({
    service: 'coachlix-ai-backend',
    status: 'ok'
  }));

  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  }));
}
