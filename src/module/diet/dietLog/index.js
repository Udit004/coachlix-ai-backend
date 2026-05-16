import { registerDietLogRoutes } from './routes.js';

export async function registerDietLogModule(fastify) {
  await fastify.register(registerDietLogRoutes);
}