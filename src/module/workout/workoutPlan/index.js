import { registerWorkoutPlanRoutes } from './routes.js';

export async function registerWorkoutPlanModule(fastify) {
  await fastify.register(registerWorkoutPlanRoutes);
}
