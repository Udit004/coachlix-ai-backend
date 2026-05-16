import { createWorkoutPlanController } from './controller.js';

export async function registerWorkoutPlanRoutes(fastify) {
  const controller = createWorkoutPlanController();

  fastify.get('/', controller.listWorkoutPlans);
  fastify.post('/', controller.createWorkoutPlan);
  fastify.put('/', controller.updateWorkoutPlanByBody);
  fastify.delete('/', controller.deleteWorkoutPlanByQuery);

  fastify.get('/:id', controller.getWorkoutPlan);
  fastify.put('/:id', controller.updateWorkoutPlan);
  fastify.delete('/:id', controller.deleteWorkoutPlan);

  fastify.post('/:id/activate', controller.activateWorkoutPlan);
  fastify.delete('/:id/activate', controller.deactivateWorkoutPlan);

  fastify.post('/:id/clone', controller.cloneWorkoutPlan);

  fastify.get('/:id/stats', controller.getWorkoutStats);

  fastify.get('/:id/progress', controller.getProgressHistory);
  fastify.post('/:id/progress', controller.addProgressEntry);
  fastify.put('/:id/progress/batch', controller.batchUpdateProgressEntries);
  fastify.get('/:id/progress/:progressId', controller.getProgressEntry);
  fastify.put('/:id/progress/:progressId', controller.updateProgressEntry);
  fastify.delete('/:id/progress/:progressId', controller.deleteProgressEntry);
}
