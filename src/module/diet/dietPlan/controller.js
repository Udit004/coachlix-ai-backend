import { verifyUserToken } from '../../../shared/auth.js';

import {
  addDay,
  addFoodItem,
  addMeal,
  cloneDietPlan,
  createDietPlan,
  deleteDietPlan,
  deleteFoodItem,
  deletePlanByQuery,
  generateAiDietPlan,
  getDietPlan,
  getNutritionSummary,
  listDietPlans,
  setPlanActiveState,
  updateDay,
  updateDietPlan,
  updateFoodItem,
  updatePlanByBody
} from './dietPlanService.js';

function resolveUser(request) {
  return request.user?.firebaseUid || request.user?.uid;
}

function readAuthHeader(request) {
  return request.headers.authorization || request.headers.Authorization || '';
}

async function authenticate(request) {
  if (request.user) {
    return request.user;
  }

  const authHeader = readAuthHeader(request);
  if (!authHeader) {
    throw request.server.httpErrors.unauthorized('Authorization header missing');
  }

  try {
    const user = await verifyUserToken(authHeader);
    request.user = user;
    return user;
  } catch (error) {
    throw request.server.httpErrors.unauthorized(error.message || 'Unauthorized');
  }
}

function wrap(handler) {
  return async (request, reply) => {
    try {
      await authenticate(request);
      return await handler(request, reply);
    } catch (error) {
      const statusCode = error.statusCode || error.status || 500;
      return reply.code(statusCode).send({
        message: error.message || 'Internal server error',
        error: statusCode >= 500 ? error.message : undefined
      });
    }
  };
}

export function createDietPlanController() {
  return {
    listDietPlans: wrap(async (request) => {
      const userId = resolveUser(request);
      return listDietPlans(userId, request.query);
    }),
    createDietPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const response = await createDietPlan(userId, request.body || {});
      return reply.code(201).send(response);
    }),
    updateDietPlanByBody: wrap(async (request) => {
      const userId = resolveUser(request);
      return updatePlanByBody(userId, request.body || {});
    }),
    deleteDietPlanByQuery: wrap(async (request) => {
      const userId = resolveUser(request);
      return deletePlanByQuery(userId, request.query.planId);
    }),
    generateAiDietPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const response = await generateAiDietPlan(userId, request.body || {});
      return reply.code(201).send(response);
    }),
    getDietPlanById: wrap(async (request) => {
      const userId = resolveUser(request);
      return getDietPlan(userId, request.params.id);
    }),
    updateDietPlanById: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateDietPlan(userId, request.params.id, request.body || {});
    }),
    deleteDietPlanById: wrap(async (request) => {
      const userId = resolveUser(request);
      return deleteDietPlan(userId, request.params.id);
    }),
    activateDietPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return setPlanActiveState(userId, request.params.id, true);
    }),
    deactivateDietPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return setPlanActiveState(userId, request.params.id, false);
    }),
    cloneDietPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const clonedPlan = await cloneDietPlan(userId, request.params.id, request.body?.name);
      return reply.code(201).send(clonedPlan);
    }),
    getNutritionSummary: wrap(async (request) => {
      const userId = resolveUser(request);
      return getNutritionSummary(userId, request.params.id);
    }),
    addDietDay: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await addDay(userId, request.params.id, request.body || {});
      return reply.code(201).send(result);
    }),
    updateDietDay: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateDay(userId, request.params.id, Number.parseInt(request.params.dayNumber, 10), request.body || {});
    }),
    addDietMeal: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await addMeal(userId, request.params.id, Number.parseInt(request.params.dayNumber, 10), request.body || {});
      return reply.code(201).send(result);
    }),
    addDietMealItem: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await addFoodItem(
        userId,
        request.params.id,
        Number.parseInt(request.params.dayNumber, 10),
        request.params.mealType,
        request.body || {}
      );
      return reply.code(201).send(result);
    }),
    updateDietMealItem: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateFoodItem(
        userId,
        request.params.id,
        Number.parseInt(request.params.dayNumber, 10),
        request.params.mealType,
        Number.parseInt(request.params.itemIndex, 10),
        request.body || {}
      );
    }),
    deleteDietMealItem: wrap(async (request) => {
      const userId = resolveUser(request);
      return deleteFoodItem(
        userId,
        request.params.id,
        Number.parseInt(request.params.dayNumber, 10),
        request.params.mealType,
        Number.parseInt(request.params.itemIndex, 10)
      );
    })
  };
}