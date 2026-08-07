// src/services/memoryThrottle.js
// Shared throttling + content-gating helpers for the memory pipeline.
//
// The memory summarizer and promotion worker both call the Gemini LLM. Without
// guards, every chat turn triggers multiple LLM calls which quickly exhaust the
// model's rate limit. This module adds:
//   - per-session cooldowns (only run once per window)
//   - debounced "last run" tracking in Redis
//   - content gating so trivial / error / short conversations skip the LLM
//   - a global in-process rate limiter so memory calls stay within budget

import { env } from '../config/env.js';
import { cache } from '../lib/redis.js';

const LAST_RUN_KEY = (kind, sessionId) => `memory:lastrun:${kind}:${sessionId}`;
const GLOBAL_BUCKET_KEY = 'memory:llm:global';
const USER_BUCKET_KEY = (userId) => `memory:llm:user:${userId}`;
const TURN_LOCK_KEY = (sessionId) => `memory:turnlock:${sessionId}`;
const GLOBAL_LIMIT = env.memoryLlmMaxPerMinute;
const GLOBAL_WINDOW_MS = 60 * 1000;

// In-process + persistent token bucket for the global memory LLM budget.
let inProcessCalls = 0;
let inProcessResetAt = Date.now() + GLOBAL_WINDOW_MS;

const TRIVIAL_PATTERN =
  /(^\s*(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|nice|good|bye|cool|awesome|perfect|done|got it|hii|heyy)[\s!.?]*$)/i;

const ERROR_PATTERN =
  /(i'll get back|having trouble|try again|apologize|error|unable to process|something went wrong)/i;

const MEMORY_WORTHY_PATTERN =
  /\b(goal|prefer|like|want|need|avoid|allerg|injur|pain|schedule|train|workout|diet|meal|protein|calorie|weight|muscle|fat|equipment|gym|run|swim|yoga|vegetarian|vegan|egg|milk|gluten)\b/i;

function min(a, b) {
  return a < b ? a : b;
}

/**
 * Reset the in-process budget counter (mainly for tests).
 */
export function resetMemoryThrottle() {
  inProcessCalls = 0;
  inProcessResetAt = Date.now() + GLOBAL_WINDOW_MS;
}

/**
 * Check whether the global memory LLM budget allows another call.
 * Uses both an in-process counter and a Redis-backed sliding window.
 */
export async function canSpendMemoryLlmBudget() {
  // Reset in-process window if it expired.
  if (Date.now() >= inProcessResetAt) {
    inProcessCalls = 0;
    inProcessResetAt = Date.now() + GLOBAL_WINDOW_MS;
  }

  if (inProcessCalls >= GLOBAL_LIMIT) {
    return false;
  }

  // Redis-backed window (shared across instances). We use a simple counter
  // with a TTL window; if the key is near the limit we skip the call.
  try {
    const current = Number((await cache.get(GLOBAL_BUCKET_KEY)) || 0);
    if (current >= GLOBAL_LIMIT) {
      return false;
    }
    await cache.set(GLOBAL_BUCKET_KEY, current + 1, 60);
  } catch {
    // If Redis is unavailable, fall back to the in-process counter only.
  }

  inProcessCalls += 1;
  return true;
}

/**
 * Mark a session as processed for a given memory kind so we don't re-run the
 * LLM too often for the same conversation.
 */
export async function markMemoryRun(kind, sessionId) {
  try {
    await cache.set(
      LAST_RUN_KEY(kind, sessionId),
      Date.now(),
      env.memoryCooldownSeconds
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the session is still within its cooldown window for the
 * given kind (i.e. we should skip processing).
 */
export async function isWithinCooldown(kind, sessionId) {
  try {
    const raw = await cache.get(LAST_RUN_KEY(kind, sessionId));
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < env.memoryCooldownSeconds * 1000;
  } catch {
    return false;
  }
}

/**
 * Atomically acquire the per-session turn lock (SET NX). Only ONE memory
 * worker (promotion OR summarization) can hold the lock for a session, so at
 * most ONE memory LLM call runs per session per gap window. The lock TTL is
 * the memoryTurnGapSeconds window.
 */
export async function acquireTurnLock(sessionId, ttlSeconds = env.memoryTurnGapSeconds) {
  if (!sessionId) return false;
  try {
    const key = TURN_LOCK_KEY(sessionId);
    const acquired = await cache.setIfAbsent(key, Date.now(), ttlSeconds);
    return Boolean(acquired);
  } catch {
    return false;
  }
}

/**
 * Per-user per-minute memory LLM budget. Mirrors the global budget but scoped
 * to a single user so one chatty user cannot exhaust the shared pool.
 */
export async function canSpendMemoryLlmBudgetForUser(userId) {
  if (!userId) return true;

  const limit = env.memoryLlmMaxPerUserPerMinute;
  const windowSeconds = 60;

  try {
    const key = USER_BUCKET_KEY(userId);
    const current = Number((await cache.get(key)) || 0);
    if (current >= limit) {
      return false;
    }
    await cache.set(key, current + 1, windowSeconds);
    return true;
  } catch {
    // If Redis is unavailable, fall back to allowing (the global budget and
    // the per-session turn lock still guard against runaway calls).
    return true;
  }
}

/**
 * Decide whether a conversation is worth spending an LLM call on for memory
 * extraction/summarization. Returns false for trivial, error-only, or
 * memory-irrelevant conversations.
 *
 * @param {Array} messages - session messages [{role, content}]
 * @param {Object} opts - { minMessages, requireRelevant }
 */
export function isMemoryWorthy(messages = [], opts = {}) {
  const minMessages = opts.minMessages ?? env.memorySummaryThreshold;
  if (!Array.isArray(messages) || messages.length < minMessages) {
    return false;
  }

  const userTexts = messages
    .filter((m) => m?.role === 'user')
    .map((m) => String(m?.content || ''))
    .filter((t) => t.trim().length > 0);

  if (userTexts.length === 0) return false;

  // Skip if the whole conversation is trivial small talk.
  const allUser = userTexts.join(' ').trim();
  if (TRIVIAL_PATTERN.test(allUser) || allUser.length < 20) {
    return false;
  }

  // Skip if the assistant only produced error responses.
  const assistantTexts = messages
    .filter((m) => m?.role !== 'user')
    .map((m) => String(m?.content || ''));
  if (assistantTexts.length > 0 && assistantTexts.every((t) => ERROR_PATTERN.test(t))) {
    return false;
  }

  // Optional: require at least one memory-relevant signal from the user.
  if (opts.requireRelevant && !MEMORY_WORTHY_PATTERN.test(allUser)) {
    return false;
  }

  return true;
}

/**
 * Extract memory-relevant content heuristically WITHOUT calling the LLM.
 * Returns an array of candidate facts for the common Coachlix patterns.
 * This is a cheap fallback that avoids burning the LLM budget on easy cases.
 */
export function heuristicExtractFacts(messages = []) {
  const facts = [];
  const seen = new Set();

  const push = (fact, type, confidence, tags = []) => {
    const key = `${type}:${String(fact).toLowerCase().trim()}`;
    if (!fact || seen.has(key)) return;
    seen.add(key);
    facts.push({ fact, type, confidence, tags });
  };

  const userTexts = messages
    .filter((m) => m?.role === 'user')
    .map((m) => String(m?.content || ''));

  for (const text of userTexts) {
    const lower = text.toLowerCase();

    // Goal patterns
    const goalMatch =
      lower.match(/(?:goal|want|wants|aiming|trying|looking) to (lose|gain|build|maintain|reduce|increase)\s+(\d+\s*(?:kg|lbs|pounds|kgs)?)/) ||
      lower.match(/(?:want|like|need|prefer) to (gain muscle|build muscle|lose weight|burn fat|get fit|improve strength|run (?:a|faster))/);
    if (goalMatch) {
      push(`User wants to ${goalMatch[1] || goalMatch[2] || 'achieve their fitness goal'}.`, 'goal', 0.8, ['goal']);
    }

    // Weight loss / gain explicit
    const weightMatch = lower.match(/(lose|gain)\s+(\d+)\s*(kg|lbs|pounds|kgs)/);
    if (weightMatch) {
      push(`User wants to ${weightMatch[1]} ${weightMatch[2]} ${weightMatch[3]}.`, 'goal', 0.85, ['goal', 'weight']);
    }

    // Dietary preference
    const dietMatch = lower.match(/\b(vegetarian|vegan|keto|paleo|gluten.?free|dairy.?free|high.?protein|low.?carb|intermittent fasting|pescatarian)\b/);
    if (dietMatch) {
      push(`User prefers a ${dietMatch[1]} diet.`, 'preference', 0.8, ['diet', dietMatch[1]]);
    }

    // Disliked / avoid food
    const avoidMatch = lower.match(/don'?t (?:like|eat|want).*?\b(\w+)\b/);
    if (avoidMatch && !lower.includes('don\'t want to lose')) {
      push(`User avoids ${avoidMatch[1]}.`, 'preference', 0.7, ['avoid', 'food']);
    }

    // Injury / constraint
    const injuryMatch = lower.match(/\b(injur|hurt|pain|problem|issue)\b.*?\b(knee|back|shoulder|ankle|wrist|elbow|hip|neck)\b/);
    if (injuryMatch) {
      push(`User has ${injuryMatch[1]} in their ${injuryMatch[2]}.`, 'injury', 0.85, ['injury', injuryMatch[2]]);
    }

    // Schedule / frequency
    const scheduleMatch = lower.match(/\b(\d+)\s*(?:times?|days?|x)\s*(?:per|a|each)?\s*(?:week|day)\b/);
    if (scheduleMatch) {
      push(`User trains ${scheduleMatch[1]} times per week.`, 'schedule', 0.7, ['schedule']);
    }

    // Equipment
    const equipMatch = lower.match(/\b(dumbbells?|barbell|kettlebell|resistance bands?|treadmill|stationary bike|home gym|gym membership)\b/);
    if (equipMatch) {
      push(`User has access to ${equipMatch[1]}.`, 'entity', 0.7, ['equipment']);
    }
  }

  return facts.slice(0, 8);
}

export default {
  canSpendMemoryLlmBudget,
  canSpendMemoryLlmBudgetForUser,
  acquireTurnLock,
  markMemoryRun,
  isWithinCooldown,
  isMemoryWorthy,
  heuristicExtractFacts,
  resetMemoryThrottle,
};
