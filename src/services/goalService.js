// src/services/goalService.js
// Goal-based agent service. Holds a durable goal, tracks progress against a
// measurable target, generates/plans actionable steps, and detects milestones
// (completion, stalls, check-ins due). Reused by the LangGraph goal nodes and
// the proactive scheduler so the assistant behaves like a real coach.

import UserGoal from '../models/UserGoal.js';
import { connectMongo } from '../db/mongo.js';
import { emitAiEvent } from './eventBus.js';
import { promoteFact } from './longTermMemoryService.js';
import goalCache from './goalCache.js';

const GOAL_TYPES = ['weight_loss', 'muscle_gain', 'endurance', 'nutrition', 'general'];

const ALLOWED_STATUS = ['active', 'paused', 'completed', 'archived'];
const ALLOWED_STEP_STATUS = ['pending', 'in_progress', 'completed', 'skipped'];

function normalizeType(raw) {
  const value = String(raw || '').toLowerCase().replace(/[\s_]+/g, '_');
  return GOAL_TYPES.includes(value) ? value : 'general';
}

function normalizeStatus(raw, fallback = 'active') {
  const value = String(raw || '').toLowerCase();
  return ALLOWED_STATUS.includes(value) ? value : fallback;
}

function computePercent(target) {
  if (!target) return 0;
  const start = Number(target.startValue);
  const current = Number(target.currentValue);
  const end = Number(target.targetValue);
  if (!Number.isFinite(start) || !Number.isFinite(current) || !Number.isFinite(end)) {
    return 0;
  }
  if (start === end) return current >= end ? 100 : 0;
  const pct = ((current - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Build a default plan for a goal type. Used when the user sets a goal
 * without specifying an explicit plan.
 */
function buildDefaultPlan(type, description = '') {
  const text = `${description} ${type}`.toLowerCase();
  const steps = [];

  if (type === 'weight_loss' || /\blose\b|\bweight\b|\bfat\b/.test(text)) {
    steps.push(
      { title: 'Set a baseline', action: 'Log current weight and measurements', tool: 'profile', status: 'pending' },
      { title: 'Calorie discipline', action: 'Follow a moderate calorie deficit diet', tool: 'diet', status: 'pending' },
      { title: 'Consistent training', action: 'Complete 3-4 workouts per week', tool: 'workout', status: 'pending' },
      { title: 'Weekly check-in', action: 'Re-measure and review progress', tool: 'goal', status: 'pending' }
    );
  } else if (type === 'muscle_gain' || /\bgain\b|\bmuscle\b|\bstrength\b/.test(text)) {
    steps.push(
      { title: 'Set a baseline', action: 'Log current strength and body stats', tool: 'profile', status: 'pending' },
      { title: 'Progressive overload', action: 'Follow a structured resistance program', tool: 'workout', status: 'pending' },
      { title: 'Protein target', action: 'Hit daily protein intake goal', tool: 'diet', status: 'pending' },
      { title: 'Monthly review', action: 'Assess strength gains and adjust', tool: 'goal', status: 'pending' }
    );
  } else if (type === 'endurance') {
    steps.push(
      { title: 'Set a baseline', action: 'Record current cardio performance', tool: 'profile', status: 'pending' },
      { title: 'Build base', action: 'Perform steady-state cardio 3x/week', tool: 'workout', status: 'pending' },
      { title: 'Increase intensity', action: 'Add interval sessions weekly', tool: 'workout', status: 'pending' },
      { title: 'Progress review', action: 'Re-test endurance and adjust plan', tool: 'goal', status: 'pending' }
    );
  } else if (type === 'nutrition' || /\bdiet\b|\bmeal\b|\bnutrition\b/.test(text)) {
    steps.push(
      { title: 'Assess intake', action: 'Log current eating patterns', tool: 'diet', status: 'pending' },
      { title: 'Build meal plan', action: 'Create a balanced meal plan', tool: 'diet', status: 'pending' },
      { title: 'Track macros', action: 'Monitor daily macros for a week', tool: 'diet', status: 'pending' },
      { title: 'Weekly review', action: 'Adjust plan based on results', tool: 'goal', status: 'pending' }
    );
  } else {
    steps.push(
      { title: 'Set baseline', action: 'Clarify your starting point', tool: 'profile', status: 'pending' },
      { title: 'First milestone', action: 'Take a first concrete action', tool: 'general', status: 'pending' },
      { title: 'Progress check', action: 'Review progress and adjust', tool: 'goal', status: 'pending' }
    );
  }

  return steps;
}

/**
 * Create a new goal for a user. If the user already has an active goal of the
 * same type, it is archived so the new goal becomes the fresh, focused target.
 */
export async function createGoal(userId, input = {}) {
  if (!userId) throw new Error('userId is required to create a goal');

  await connectMongo();
  const type = normalizeType(input.type);
  const title =
    String(input.title || '').trim() ||
    `${type.replace(/_/g, ' ')} goal`;

  const description = String(input.description || '').trim();
  const target = {
    startValue:
      input.target?.startValue !== undefined && input.target?.startValue !== null
        ? Number(input.target.startValue)
        : null,
    currentValue:
      input.target?.currentValue !== undefined && input.target?.currentValue !== null
        ? Number(input.target.currentValue)
        : null,
    targetValue:
      input.target?.targetValue !== undefined && input.target?.targetValue !== null
        ? Number(input.target.targetValue)
        : null,
    unit: String(input.target?.unit || 'kg').trim(),
    deadline: input.target?.deadline ? new Date(input.target.deadline) : null,
  };

  // Archive any existing active goal of the same type to keep focus.
  await UserGoal.updateMany(
    { userId, type, status: 'active' },
    { $set: { status: 'archived', updatedAt: new Date() } }
  );

  const plan = Array.isArray(input.plan) && input.plan.length > 0
    ? input.plan
        .filter((s) => s && s.title)
        .map((s) => ({
          title: String(s.title).trim(),
          action: String(s.action || s.title || '').trim(),
          tool: String(s.tool || 'general').trim(),
          dueDate: s.dueDate ? new Date(s.dueDate) : null,
          status: ALLOWED_STEP_STATUS.includes(s.status) ? s.status : 'pending',
          notes: String(s.notes || '').trim(),
        }))
    : buildDefaultPlan(type, description);

  const goal = await UserGoal.create({
    userId,
    title,
    type,
    description,
    status: normalizeStatus(input.status, 'active'),
    target,
    plan,
    progress: {
      percent: computePercent(target),
      lastCheckInAt: new Date(),
      streak: 0,
    },
    checkInFrequency: ['daily', 'weekly', 'on_demand'].includes(input.checkInFrequency)
      ? input.checkInFrequency
      : 'weekly',
    source: String(input.source || 'conversation'),
  });

  // Persist the goal as a durable long-term memory fact too, so it is
  // available to semantic recall even before the goal service is queried.
  if (goal) {
    await promoteFact({
      userId,
      factType: 'goal',
      content: `Active goal: ${goal.title}${goal.target?.targetValue ? ` (target ${goal.target.targetValue} ${goal.target.unit})` : ''}`,
      confidence: 0.8,
      source: 'goal',
      tags: ['goal', goal.type],
    }).catch(() => {});
  }

  await emitAiEvent('goal.created', {
    userId,
    goalId: String(goal._id),
    type: goal.type,
    title: goal.title,
  });

  // Warm the active-goal cache and clear any pending draft now that the goal
  // is realized.
  await goalCache.setCachedActiveGoal(userId, goal);
  await goalCache.clearGoalDraft(userId);

  return goal;
}

/**
 * Create a durable goal directly from a per-turn agent plan. Used when the
 * assistant and user agree to persist an in-progress conversation goal (e.g.
 * "build my plan") without forcing the user to re-state all details. The goal
 * type and an initial plan are derived from the turn plan's task breakdown.
 */
export async function createGoalFromTurnPlan(userId, turnPlan = {}, extra = {}) {
  if (!userId) throw new Error('userId is required to create a goal from a turn plan');
  if (!turnPlan?.goal && !extra.title) {
    throw new Error('A turn-plan goal or title is required');
  }

  const breakdown = Array.isArray(turnPlan.taskBreakdown) ? turnPlan.taskBreakdown : [];
  const type = ['weight_loss', 'muscle_gain', 'endurance', 'nutrition', 'general'].includes(
    String(turnPlan.goalType || extra.type || '').toLowerCase()
  )
    ? String(turnPlan.goalType || extra.type).toLowerCase()
    : 'general';

  const plan = breakdown.length
    ? breakdown.map((step) => ({
        title: String(step.title || step.action || 'Step'),
        action: String(step.action || step.title || ''),
        tool: String(step.tool || 'general').slice(0, 30),
        status: 'pending',
      }))
    : [];

  const input = {
    title: extra.title || String(turnPlan.goal || '').trim(),
    description: String(extra.description || '').trim() || undefined,
    type,
    plan,
    target: {
      currentValue: extra.currentValue ?? null,
      targetValue: extra.targetValue ?? null,
      startValue: extra.currentValue ?? null,
      unit: extra.unit || 'kg',
    },
    source: 'turn_plan',
    checkInFrequency: extra.checkInFrequency || 'weekly',
  };

  return createGoal(userId, input);
}

/**
 * Update a goal's measurable progress. Recomputes percent and detects if the
 * goal just completed or if progress has stalled.
 */
export async function updateGoalProgress(userId, goalId, input = {}) {
  if (!userId || !goalId) throw new Error('userId and goalId are required');

  await connectMongo();
  const goal = await UserGoal.findOne({ _id: goalId, userId });
  if (!goal) return null;

  if (goal.status !== 'active') {
    throw new Error('Goal is not active');
  }

  const now = new Date();
  const prevCurrent = Number(goal.target?.currentValue);
  const newCurrent =
    input.currentValue !== undefined && input.currentValue !== null
      ? Number(input.currentValue)
      : input.weight !== undefined && input.weight !== null
        ? Number(input.weight)
        : prevCurrent;

  if (Number.isFinite(newCurrent)) {
    goal.target.currentValue = newCurrent;
  }

  if (input.deadline) goal.target.deadline = new Date(input.deadline);
  if (input.unit) goal.target.unit = String(input.unit).trim();

  const hadProgress =
    Number.isFinite(prevCurrent) &&
    Number.isFinite(newCurrent) &&
    newCurrent !== prevCurrent;

  goal.progress.percent = computePercent(goal.target);
  goal.progress.lastCheckInAt = now;
  if (hadProgress) {
    goal.progress.lastProgressAt = now;
    goal.progress.stalledSince = null;
    goal.progress.streak = (goal.progress.streak || 0) + 1;
  } else {
    goal.progress.stalledSince = goal.progress.stalledSince || now;
  }

  // Auto-complete when the target is reached.
  if (
    goal.progress.percent >= 100 &&
    Number.isFinite(Number(goal.target?.currentValue)) &&
    Number.isFinite(Number(goal.target?.targetValue))
  ) {
    goal.status = 'completed';
  }

  await goal.save();

  await emitAiEvent(
    goal.progress.percent >= 100 ? 'goal.completed' : 'goal.progress.updated',
    {
      userId,
      goalId: String(goal._id),
      percent: goal.progress.percent,
      currentValue: goal.target?.currentValue,
      targetValue: goal.target?.targetValue,
    }
  );

  // Invalidate the cache so the next read re-warms with the new progress.
  await goalCache.invalidateCachedActiveGoal(userId);

  return goal;
}

/**
 * Mark a plan step as completed/skipped/in_progress and detect milestone
 * completion (all steps done).
 */
export async function updateGoalStep(goalId, stepIndex, status) {
  if (!goalId) throw new Error('goalId is required');
  if (!ALLOWED_STEP_STATUS.includes(status)) {
    throw new Error(`Invalid step status: ${status}`);
  }

  await connectMongo();
  const goal = await UserGoal.findById(goalId);
  if (!goal || !Array.isArray(goal.plan)) return null;

  const step = goal.plan[stepIndex];
  if (!step) return null;

  step.status = status;
  if (status === 'completed') {
    step.completedAt = new Date();
  }

  const completedSteps = goal.plan.filter((s) => s.status === 'completed').length;
  const totalSteps = goal.plan.length;
  if (totalSteps > 0) {
    goal.progress.stepCompletion = Math.round((completedSteps / totalSteps) * 100);
  }

  await goal.save();

  if (completedSteps === totalSteps && totalSteps > 0) {
    await emitAiEvent('goal.milestone.reached', {
      userId: goal.userId,
      goalId: String(goal._id),
      completedSteps,
      totalSteps,
    });
  }

  // Invalidate the user's active-goal cache so the updated plan step is
  // reflected on the next read.
  await goalCache.invalidateCachedActiveGoal(goal.userId);

  return goal;
}

/**
 * Get the user's active goal (single focused goal).
 * Reads from the Redis cache first for fast hot-path lookups (the LangGraph
 * goal node runs on every personalized turn), then falls back to MongoDB and
 * warms the cache.
 */
export async function getActiveGoal(userId) {
  if (!userId) return null;

  const cached = await goalCache.getCachedActiveGoal(userId);
  if (cached) {
    return cached;
  }

  await connectMongo();
  const goal = await UserGoal.findOne({ userId, status: 'active' }).sort({ updatedAt: -1 });

  // Warm the cache whether or not a goal exists (null clears any stale entry).
  await goalCache.setCachedActiveGoal(userId, goal || null);

  return goal;
}

/**
 * Get all goals for a user, optionally filtered by status.
 */
export async function getGoalHistory(userId, status) {
  if (!userId) return [];
  await connectMongo();
  const filter = { userId };
  if (status && ALLOWED_STATUS.includes(status)) filter.status = status;
  return UserGoal.find(filter).sort({ updatedAt: -1 }).lean();
}

/**
 * Decide the next concrete action for a goal given its current progress.
 * Returns the first pending/in-progress step, or a completion notice.
 */
export async function planNextStep(userId, goal) {
  const activeGoal = goal || (await getActiveGoal(userId));
  if (!activeGoal) return null;

  if (activeGoal.status === 'completed') {
    return { done: true, message: 'All steps completed. Consider setting a new goal.' };
  }

  const plan = Array.isArray(activeGoal.plan) ? activeGoal.plan : [];
  const next = plan.find((s) => s.status === 'pending' || s.status === 'in_progress');

  return {
    step: next || null,
    percent: activeGoal.progress?.percent || 0,
    goalId: String(activeGoal._id),
    done: !next,
    message: next
      ? `Next step: ${next.title} — ${next.action}`
      : 'No pending steps. All planned actions are complete.',
  };
}

/**
 * Check whether a goal needs a proactive check-in because it is stalled or
 * its check-in window has passed. Returns a reason or null.
 */
export async function checkGoalMilestones(userId) {
  const activeGoal = await getActiveGoal(userId);
  if (!activeGoal) return null;

  const now = Date.now();
  const lastCheckIn = activeGoal.progress?.lastCheckInAt
    ? new Date(activeGoal.progress.lastCheckInAt).getTime()
    : now;
  const lastProgress = activeGoal.progress?.lastProgressAt
    ? new Date(activeGoal.progress.lastProgressAt).getTime()
    : null;

  const frequencyMs = activeGoal.checkInFrequency === 'daily'
    ? 24 * 60 * 60 * 1000
    : activeGoal.checkInFrequency === 'weekly'
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000; // on_demand -> generous

  if (activeGoal.status === 'completed') {
    return { reason: 'completed', goal: activeGoal };
  }

  if (lastProgress && now - lastProgress > 7 * 24 * 60 * 60 * 1000) {
    return { reason: 'stalled', goal: activeGoal, daysSince: Math.floor((now - lastProgress) / (24 * 60 * 60 * 1000)) };
  }

  if (now - lastCheckIn > frequencyMs) {
    return { reason: 'check_in_due', goal: activeGoal, lastCheckIn: new Date(lastCheckIn) };
  }

  return null;
}

/**
 * Format a goal + plan + progress into a compact prompt section for the LLM.
 */
export function formatGoalForContext(goal) {
  if (!goal) return '';

  const lines = [];
  lines.push(`=== ACTIVE GOAL ===`);
  lines.push(`Goal: ${goal.title} (${goal.type})`);
  if (goal.description) lines.push(`Description: ${goal.description}`);
  if (goal.target?.targetValue != null) {
    lines.push(
      `Target: ${goal.target.currentValue ?? goal.target.startValue ?? '?'} -> ${goal.target.targetValue} ${goal.target.unit}`
    );
  }
  lines.push(`Progress: ${goal.progress?.percent ?? 0}%`);
  if (goal.deadline) lines.push(`Deadline: ${new Date(goal.deadline).toISOString().slice(0, 10)}`);

  if (Array.isArray(goal.plan) && goal.plan.length > 0) {
    lines.push('Plan:');
    goal.plan.forEach((step, i) => {
      lines.push(`  ${i + 1}. [${step.status}] ${step.title} — ${step.action}`);
    });
  }

  return lines.join('\n');
}

export default {
  createGoal,
  createGoalFromTurnPlan,
  updateGoalProgress,
  updateGoalStep,
  getActiveGoal,
  getGoalHistory,
  planNextStep,
  checkGoalMilestones,
  formatGoalForContext,
};
