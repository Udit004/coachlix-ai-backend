// src/ai/graph/fitness/nodes/goalNode.js
// Goal-aware agent node. Loads the user's active goal during the personalized
// (RAG) path and appends it to the userContext so the LLM reasons in the
// context of the user's objective, plan, and progress. Also parses a
// goal-related message into a concrete goal action (create / progress / next).

import {
  getActiveGoal,
  createGoal,
  updateGoalProgress,
  planNextStep,
  formatGoalForContext,
} from "../../../../services/goalService.js";

const emitEvent = (state, type, payload) => {
  if (typeof state?.onEvent === "function") {
    try {
      state.onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:goal] onEvent failed for ${type}:`, error?.message || error);
    }
  }
};

// Rough, dependency-free detection of goal-related intent. The LLM classifier
// already handles sophisticated intent; this provides a fast heuristic path
// for explicit goal statements and check-ins.
const GOAL_CREATE_PATTERN =
  /\b(i want to|i need to|i'd like to|my goal is|set.*goal|create.*goal|i am trying to|aim(ing)? to)\b/i;
const GOAL_PROGRESS_PATTERN =
  /\b(progress|update.*(weight|progress)|i (weigh|now weigh|lost|gained)|check.?in|milestone|next step|what'?s next)\b/i;
const GOAL_LOOKUP_PATTERN =
  /\b(what('?s| is) my goal|show.*goal|my (active )?goal|goal status|am i on track)\b/i;

function detectGoalAction(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  if (GOAL_LOOKUP_PATTERN.test(text)) return "lookup";
  if (GOAL_PROGRESS_PATTERN.test(text)) return "progress";
  if (GOAL_CREATE_PATTERN.test(text)) return "create";
  return null;
}

/**
 * Extract a lightweight goal payload from a natural-language statement.
 * Relies on the LLM for precise parsing in the full flow; here we do a
 * best-effort fill so the goal can be created even without a dedicated
 * classifier call.
 */
function extractGoalPayload(message, profile) {
  const text = String(message || "").toLowerCase();
  const payload = { type: "general", target: {} };

  if (/\blose\b|\bweight loss\b|\bfat\b|\bkg\b|\bkilo/.test(text)) payload.type = "weight_loss";
  else if (/\bgain\b|\bmuscle\b|\bstrength\b|\bbulk/.test(text)) payload.type = "muscle_gain";
  else if (/\bendurance\b|\bcardio\b|\brun\b|\bstamina\b/.test(text)) payload.type = "endurance";
  else if (/\bdiet\b|\bmeal\b|\bnutrition\b|\bvegetarian\b|\bvegan\b/.test(text)) payload.type = "nutrition";

  // Try to extract a numeric target (e.g., "lose 10 kg", "target 70 kg").
  const targetMatch = text.match(/(?:lose|gain|target|reach|to)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|pounds|lb|lbs)?/i);
  if (targetMatch) {
    payload.target.targetValue = Number(targetMatch[1]);
    payload.target.unit = targetMatch[2]?.toLowerCase().includes("lb") ? "lb" : "kg";
  }

  // Seed current value from profile if available.
  if (profile?.weight) payload.target.currentValue = Number(profile.weight);
  if (profile?.targetWeight) payload.target.targetValue = Number(profile.targetWeight);

  payload.title = message;
  return payload;
}

export async function goalNode(state) {
  const { userId, originalMessage, profile, userContext } = state;
  const t0 = Date.now();

  // Always try to load the user's active goal so prompts stay goal-aware.
  let activeGoal = null;
  try {
    activeGoal = await getActiveGoal(userId);
  } catch (error) {
    console.error("[Graph:goal] Failed to load active goal:", error?.message || error);
  }

  // Detect a goal-related action from the message.
  const action = detectGoalAction(originalMessage);
  let goalAction = null;

  if (action) {
    try {
      if (action === "create") {
        const payload = extractGoalPayload(originalMessage, profile);
        activeGoal = await createGoal(userId, payload);
        goalAction = { kind: "created", goal: activeGoal };
        emitEvent(state, "goal.created", {
          userId,
          goalType: activeGoal.type,
          title: activeGoal.title,
        });
      } else if (action === "progress") {
        const progress = await updateGoalProgress(userId, activeGoal?._id, {
          currentValue: extractCurrentValue(originalMessage, profile),
        });
        if (progress) activeGoal = progress;
        goalAction = { kind: "progress_updated", goal: activeGoal };
        emitEvent(state, "goal.progress.updated", {
          userId,
          percent: activeGoal?.progress?.percent,
        });
      } else if (action === "lookup") {
        const next = await planNextStep(userId, activeGoal);
        goalAction = { kind: "lookup", goal: activeGoal, next };
        emitEvent(state, "goal.lookup", { userId, hasGoal: Boolean(activeGoal) });
      }
    } catch (error) {
      console.error("[Graph:goal] Goal action failed:", error?.message || error);
    }
  }

  const elapsed = Date.now() - t0;

  emitEvent(state, "ai.context.resolved", {
    userId,
    hasGoal: Boolean(activeGoal),
    goalAction: goalAction?.kind || null,
    durationMs: elapsed,
  });

  // Attach the goal (and its formatted context) to the user context so the
  // prompt builders can inject it.
  const enrichedContext = {
    ...(userContext || {}),
    activeGoal: activeGoal || null,
    goalContext: formatGoalForContext(activeGoal),
    goalAction,
  };

  return {
    activeGoal,
    goalAction,
    userContext: enrichedContext,
    flowMetrics: { goalRetrievalTime: elapsed },
  };
}

function extractCurrentValue(message, profile) {
  const text = String(message || "").toLowerCase();
  const match = text.match(/(?:weigh|now)\s+(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|pounds|lb|lbs)/i);
  if (match) return Number(match[1]);
  return profile?.weight ? Number(profile.weight) : undefined;
}
