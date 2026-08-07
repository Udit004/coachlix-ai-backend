// src/services/goalCache.js
// Redis-backed cache and draft storage for the goal-based agent.
//
// Two kinds of data live here:
//   1. the user's ACTIVE goal (a fast, warmed copy of the MongoDB doc) so
//      hot lookups in the LangGraph path avoid a DB round-trip.
//   2. a DRAFT goal (a partial goal awaiting clarification) so the agent can
//      pause to ask a question and resume later without losing partial input.
//
// All writes invalidate the corresponding active-goal cache so the next read
// re-warms from MongoDB. Missing Redis is handled gracefully (Noop fallback)
// so the goal agent still works purely on MongoDB.

import { redis } from '../shared/cache.js';
import { env } from '../config/env.js';

const activeKey = (userId) => `goal:active:${userId}`;
const draftKey = (userId) => `goal:draft:${userId}`;
const turnKey = (userId) => `goal:turn:${userId}`;

/**
 * Whether we have a usable Redis client. If not, every cache op is a Noop so
 * the goal agent degrades safely to MongoDB-only.
 */
export function isGoalCacheEnabled() {
  return !!env.upstashRedisRestUrl && !!env.upstashRedisRestToken;
}

/**
 * Read the cached active goal for a user. Returns a parsed object or null.
 */
export async function getCachedActiveGoal(userId) {
  if (!userId || !isGoalCacheEnabled()) return null;
  try {
    const raw = await redis.get(activeKey(userId));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    console.warn('[GoalCache] getCachedActiveGoal failed:', error?.message || error);
    return null;
  }
}

/**
 * Cache the user's active goal (serialized). Passing null/undefined removes
 * the entry (a cache miss arrow) so a stale goal is never served after the
 * user has no active goal.
 */
export async function setCachedActiveGoal(userId, goal) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    if (!goal) {
      await redis.del(activeKey(userId));
      return true;
    }
    await redis.set(
      activeKey(userId),
      JSON.stringify(goal),
      'EX',
      env.goalActiveCacheTtlSeconds
    );
    return true;
  } catch (error) {
    console.warn('[GoalCache] setCachedActiveGoal failed:', error?.message || error);
    return false;
  }
}

/**
 * Invalidate the cached active goal for a user (called after create/update/
 * complete/archive so the next read re-warms from MongoDB).
 */
export async function invalidateCachedActiveGoal(userId) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    await redis.del(activeKey(userId));
    return true;
  } catch (error) {
    console.warn('[GoalCache] invalidateCachedActiveGoal failed:', error?.message || error);
    return false;
  }
}

// ── Goal draft (awaiting clarification) ──────────────────────────────────

/**
 * Read a pending goal draft for a user. Returns the parsed draft or null.
 */
export async function getGoalDraft(userId) {
  if (!userId || !isGoalCacheEnabled()) return null;
  try {
    const raw = await redis.get(draftKey(userId));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    console.warn('[GoalCache] getGoalDraft failed:', error?.message || error);
    return null;
  }
}

/**
 * Persist a goal draft. The draft includes the partial payload and the list
 * of fields we still need from the user.
 */
export async function setGoalDraft(userId, draft) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    await redis.set(
      draftKey(userId),
      JSON.stringify(draft),
      'EX',
      env.goalDraftTtlSeconds
    );
    return true;
  } catch (error) {
    console.warn('[GoalCache] setGoalDraft failed:', error?.message || error);
    return false;
  }
}

/**
 * Clear a pending goal draft (called once the goal has been created or the
 * draft is abandoned).
 */
export async function clearGoalDraft(userId) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    await redis.del(draftKey(userId));
    return true;
  } catch (error) {
    console.warn('[GoalCache] clearGoalDraft failed:', error?.message || error);
    return false;
  }
}

// ── Per-turn agent plan (goal-based planner pause/resume) ────────────────

/**
 * Read the in-flight turn plan for a user. Returns the parsed plan or null.
 * Used to RESUME a goal-oriented exchange without re-planning (cost saver).
 */
export async function getTurnPlan(userId) {
  if (!userId || !isGoalCacheEnabled()) return null;
  try {
    const raw = await redis.get(turnKey(userId));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    console.warn('[GoalCache] getTurnPlan failed:', error?.message || error);
    return null;
  }
}

/**
 * Persist the in-flight turn plan so an awaiting-input exchange can be
 * resumed later, or an active plan survives across the tool loop.
 */
export async function setTurnPlan(userId, plan) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    if (!plan) {
      await redis.del(turnKey(userId));
      return true;
    }
    await redis.set(
      turnKey(userId),
      JSON.stringify(plan),
      'EX',
      env.turnPlanTtlSeconds
    );
    return true;
  } catch (error) {
    console.warn('[GoalCache] setTurnPlan failed:', error?.message || error);
    return false;
  }
}

/**
 * Clear the in-flight turn plan (called once it completes or is abandoned).
 */
export async function clearTurnPlan(userId) {
  if (!userId || !isGoalCacheEnabled()) return false;
  try {
    await redis.del(turnKey(userId));
    return true;
  } catch (error) {
    console.warn('[GoalCache] clearTurnPlan failed:', error?.message || error);
    return false;
  }
}

export default {
  isGoalCacheEnabled,
  getCachedActiveGoal,
  setCachedActiveGoal,
  invalidateCachedActiveGoal,
  getGoalDraft,
  setGoalDraft,
  clearGoalDraft,
  getTurnPlan,
  setTurnPlan,
  clearTurnPlan,
};
