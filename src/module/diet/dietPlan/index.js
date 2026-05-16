import { registerDietPlanRoutes } from './routes.js';

export async function registerDietPlanModule(fastify) {
  await fastify.register(registerDietPlanRoutes);
}