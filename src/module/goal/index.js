// src/module/goal/index.js
// Goal module registration.

import { registerGoalRoutes } from './routes.js';

export async function registerGoalModule(fastify) {
  await fastify.register(registerGoalRoutes);
}
