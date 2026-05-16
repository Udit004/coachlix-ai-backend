import { registerDashboardRoutes } from './routes.js';

export async function registerDashboardModule(fastify) {
  await fastify.register(registerDashboardRoutes, { prefix: '/dashboard' });
}