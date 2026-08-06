// src/module/goal/controller.js
// REST handlers for the goal-based agent. All endpoints require a valid
// Firebase token (extracted from the Authorization header by a shared helper).

import { verifyUserToken } from '../../shared/auth.js';
import {
  createGoal,
  updateGoalProgress,
  updateGoalStep,
  getActiveGoal,
  getGoalHistory,
  planNextStep,
} from '../../services/goalService.js';

async function getUserFromRequest(request) {
  const authHeader =
    request.headers.authorization || request.headers.Authorization || '';
  if (!authHeader) {
    const err = new Error('Authorization header missing');
    err.statusCode = 401;
    throw err;
  }
  return verifyUserToken(authHeader);
}

const wrap = (handler) => async (request, reply) => {
  try {
    const user = await getUserFromRequest(request);
    request.user = user;
    return await handler(request, reply);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      success: false,
      message: statusCode === 500 ? 'Internal server error' : error.message,
      error: statusCode === 500 ? error.message : undefined,
    });
  }
};

export const createGoalController = () => ({
  create: wrap(async (request) => {
    const goal = await createGoal(request.user.uid, request.body || {});
    return { success: true, data: goal, statusCode: 201 };
  }),

  getActive: wrap(async (request) => {
    const goal = await getActiveGoal(request.user.uid);
    return { success: true, data: goal };
  }),

  getHistory: wrap(async (request) => {
    const { status } = request.query;
    const goals = await getGoalHistory(request.user.uid, status);
    return { success: true, data: goals };
  }),

  updateProgress: wrap(async (request) => {
    const { goalId } = request.params;
    const goal = await updateGoalProgress(request.user.uid, goalId, request.body || {});
    if (!goal) {
      return { statusCode: 404, success: false, message: 'Goal not found' };
    }
    return { success: true, data: goal };
  }),

  updateStep: wrap(async (request) => {
    const { goalId, stepIndex } = request.params;
    const goal = await updateGoalStep(goalId, parseInt(stepIndex, 10), request.body?.status);
    if (!goal) {
      return { statusCode: 404, success: false, message: 'Goal or step not found' };
    }
    return { success: true, data: goal };
  }),

  nextStep: wrap(async (request) => {
    const goal = await getActiveGoal(request.user.uid);
    const next = await planNextStep(request.user.uid, goal);
    return { success: true, data: next };
  }),
});
