import { createDietPlanController } from './controller.js';

export async function registerDietPlanRoutes(fastify) {
  const controller = createDietPlanController();

  fastify.get('/', controller.listDietPlans);
  fastify.post('/', controller.createDietPlan);
  fastify.put('/', controller.updateDietPlanByBody);
  fastify.delete('/', controller.deleteDietPlanByQuery);
  fastify.post('/generate-ai', controller.generateAiDietPlan);
  fastify.get('/:id', controller.getDietPlanById);
  fastify.put('/:id', controller.updateDietPlanById);
  fastify.delete('/:id', controller.deleteDietPlanById);
  fastify.post('/:id/activate', controller.activateDietPlan);
  fastify.delete('/:id/activate', controller.deactivateDietPlan);
  fastify.post('/:id/clone', controller.cloneDietPlan);
  fastify.get('/:id/nutrition-summary', controller.getNutritionSummary);
  fastify.post('/:id/days', controller.addDietDay);
  fastify.put('/:id/days/:dayNumber', controller.updateDietDay);
  fastify.post('/:id/days/:dayNumber/meals', controller.addDietMeal);
  fastify.post('/:id/days/:dayNumber/meals/:mealType/items', controller.addDietMealItem);
  fastify.put('/:id/days/:dayNumber/meals/:mealType/items/:itemIndex', controller.updateDietMealItem);
  fastify.delete('/:id/days/:dayNumber/meals/:mealType/items/:itemIndex', controller.deleteDietMealItem);
}