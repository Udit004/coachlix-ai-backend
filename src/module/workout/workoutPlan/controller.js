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
  generateAiWorkoutPlan,
  cloneWorkoutPlan,
  getWorkoutStats,
  addProgressEntry,
  getProgressHistory,
  updateProgressEntry,
  deleteProgressEntry,
  getProgressEntry,
  batchUpdateProgressEntries,
  addWeek,
  updateWeek,
  deleteWeek,
  addWorkoutToDay,
  deleteWorkoutFromDay,
  clearDayWorkouts,
  addExercisesToWorkout,
  getWorkoutExercises,
  updateWorkoutExercises,
  deleteExerciseFromWorkout
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

    generateAiWorkoutPlan: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await generateAiWorkoutPlan(userId, request.body || {});
      return reply.code(201).send(result);
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
    }),

    // Granular management
    addWeek: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const result = await addWeek(userId, request.params.id, request.body || {});
      return reply.code(201).send(result);
    }),

    updateWeek: wrap(async (request) => {
      const userId = resolveUser(request);
      return updateWeek(userId, request.params.id, request.params.weekNumber, request.body || {});
    }),

    deleteWeek: wrap(async (request) => {
      const userId = resolveUser(request);
      return deleteWeek(userId, request.params.id, request.params.weekNumber);
    }),

    addWorkoutToDay: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber } = request.params;
      const result = await addWorkoutToDay(userId, id, weekNumber, dayNumber, request.body || {});
      return reply.code(201).send(result);
    }),

    deleteWorkoutFromDay: wrap(async (request) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber, workoutIndex } = request.params;
      return deleteWorkoutFromDay(userId, id, weekNumber, dayNumber, workoutIndex);
    }),

    clearDayWorkouts: wrap(async (request) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber } = request.params;
      return clearDayWorkouts(userId, id, weekNumber, dayNumber);
    }),

    addExercisesToWorkout: wrap(async (request, reply) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber, workoutIndex } = request.params;
      const result = await addExercisesToWorkout(userId, id, weekNumber, dayNumber, workoutIndex, request.body || {});
      return reply.code(201).send(result);
    }),

    getWorkoutExercises: wrap(async (request) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber, workoutIndex } = request.params;
      return getWorkoutExercises(userId, id, weekNumber, dayNumber, workoutIndex);
    }),

    updateWorkoutExercises: wrap(async (request) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber, workoutIndex } = request.params;
      return updateWorkoutExercises(userId, id, weekNumber, dayNumber, workoutIndex, request.body || {});
    }),

    deleteExerciseFromWorkout: wrap(async (request) => {
      const userId = resolveUser(request);
      const { id, weekNumber, dayNumber, workoutIndex, exerciseIndex } = request.params;
      return deleteExerciseFromWorkout(userId, id, weekNumber, dayNumber, workoutIndex, exerciseIndex);
    })
  };
}
