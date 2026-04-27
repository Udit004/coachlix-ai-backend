export async function apiRoutes(fastify) {
  fastify.get('/ping', async () => ({
    message: 'pong',
    time: new Date().toISOString()
  }));
}
