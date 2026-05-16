import { verifyUserToken } from '../../../shared/auth.js';

import {
  listWorkoutPlans,
  getWorkoutPlan,
  createWorkoutPlan,
  updateWorkoutPlan,
  updatePlanByBody,
  deleteWorkoutPlan,
  deletePlanByQuery,
  activateWorkoutPlan,
  deactivateWorkoutPlan,
  cloneWorkoutPlan,
  getWorkoutStats,
  addProgressEntry,
  getProgressHistory,
  updateProgressEntry,
  deleteProgressEntry,
  getProgressEntry,
  batchUpdateProgressEntries
} from './workoutPlanService.js';

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

export function createWorkoutPlanController() {
  return {
    listWorkoutPlans: wrap(async (request) => {
      const userId = resolveUser(request);
      return listWorkoutPlans(userId, request.query);
    }),

    getWorkoutPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return getWorkoutPlan(userId, request.params.id);
    }),

    createWorkoutPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const response = await createWorkoutPlan(userId, request.body || {});
      return reply.code(201).send(response);
    }),

    updateWorkoutPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateWorkoutPlan(userId, request.params.id, request.body || {});
    }),

    updateWorkoutPlanByBody: wrap(async (request) => {
      const userId = resolveUser(request);
      return updatePlanByBody(userId, request.body || {});
    }),

    deleteWorkoutPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return deleteWorkoutPlan(userId, request.params.id);
    }),

    deleteWorkoutPlanByQuery: wrap(async (request) => {
      const userId = resolveUser(request);
      return deletePlanByQuery(userId, request.query.planId);
    }),

    activateWorkoutPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return activateWorkoutPlan(userId, request.params.id);
    }),

    deactivateWorkoutPlan: wrap(async (request) => {
      const userId = resolveUser(request);
      return deactivateWorkoutPlan(userId, request.params.id);
    }),

    cloneWorkoutPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const clonedPlan = await cloneWorkoutPlan(userId, request.params.id, request.body?.name);
      return reply.code(201).send(clonedPlan);
    }),

    getWorkoutStats: wrap(async (request) => {
      const userId = resolveUser(request);
      return getWorkoutStats(userId, request.params.id);
    }),

    getProgressHistory: wrap(async (request) => {
      const userId = resolveUser(request);
      return getProgressHistory(userId, request.params.id);
    }),

    addProgressEntry: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await addProgressEntry(userId, request.params.id, request.body || {});
      return reply.code(201).send(result);
    }),

    updateProgressEntry: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateProgressEntry(userId, request.params.id, request.params.progressId, request.body || {});
    }),

    deleteProgressEntry: wrap(async (request) => {
      const userId = resolveUser(request);
      return deleteProgressEntry(userId, request.params.id, request.params.progressId);
    }),

    getProgressEntry: wrap(async (request) => {
      const userId = resolveUser(request);
      return getProgressEntry(userId, request.params.id, request.params.progressId);
    }),

    batchUpdateProgressEntries: wrap(async (request) => {
      const userId = resolveUser(request);
      return batchUpdateProgressEntries(userId, request.params.id, request.body?.entries || []);
    })
  };
}
