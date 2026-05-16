import { registerProfileRoutes } from './routes.js';

export async function registerProfileModule(fastify) {
  await fastify.register(registerProfileRoutes);
}