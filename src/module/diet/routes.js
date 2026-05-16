import { registerDietLogRoutes } from './dietLog/routes.js';
import { registerDietPlanRoutes } from './dietPlan/routes.js';

export async function registerDietRoutes(fastify) {
  await fastify.register(registerDietPlanRoutes);
  await fastify.register(registerDietLogRoutes);
}