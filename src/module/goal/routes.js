// src/module/goal/routes.js
// REST routes for the goal-based agent.

import { createGoalController } from './controller.js';

export async function registerGoalRoutes(fastify) {
  const controller = createGoalController();

  // POST /goals - Create a new goal
  fastify.post('/', controller.create);

  // GET /goals/active - Get the user's current active goal
  fastify.get('/active', controller.getActive);

  // GET /goals - Get goal history (optionally ?status=)
  fastify.get('/', controller.getHistory);

  // GET /goals/next-step - Get the next planned action
  fastify.get('/next-step', controller.nextStep);

  // PATCH /goals/:goalId/progress - Update measurable progress
  fastify.patch('/:goalId/progress', controller.updateProgress);

  // PATCH /goals/:goalId/steps/:stepIndex - Update a plan step status
  fastify.patch('/:goalId/steps/:stepIndex', controller.updateStep);
}
