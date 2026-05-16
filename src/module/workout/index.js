import { registerWorkoutPlanModule } from './workoutPlan/index.js';

export async function registerWorkoutModule(fastify) {
  await fastify.register(registerWorkoutPlanModule);
}
