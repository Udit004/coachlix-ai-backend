import { registerDietLogModule } from './dietLog/index.js';
import { registerDietPlanModule } from './dietPlan/index.js';

export async function registerDietModule(fastify) {
  await fastify.register(registerDietPlanModule);
  await fastify.register(registerDietLogModule);
}