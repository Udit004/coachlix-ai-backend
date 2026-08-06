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
import goalCache from "../../../../services/goalCache.js";

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
  /\b(i want to|i need to|i'd like to|my goal is|set.*goal|create.*goal|i am trying to|aim(ing)? to)\b|\b(create|build|make|start|set up|design|prepare)\b.*\b(diet|meal|nutrition|workout|training|fitness|goal|plan|routine|schedule)\b/i;
const GOAL_PROGRESS_PATTERN =
  /\b(progress|update.*(weight|progress)|i (weigh|now weigh|lost|gained)|check.?in|milestone|next step|what'?s next)\b/i;
const GOAL_LOOKUP_PATTERN =
  /\b(what('?s| is) my goal|show.*goal|my (active )?goal|goal status|am i on track)\b/i;
const GOAL_TYPE_PATTERNS = [
  { type: "weight_loss", pattern: /\b(lose|loss|fat loss|cut|slim|drop)\b.*\b(weight|fat|kg|kilo|lb|lbs|pounds)?|\bweight loss\b/i },
  { type: "muscle_gain", pattern: /\b(gain|build|grow|bulk)\b.*\b(muscle|strength|mass)\b|\bmuscle gain\b/i },
  { type: "nutrition", pattern: /\b(diet|meal|nutrition|macro|macros|calorie|protein|vegetarian|vegan)\b/i },
  { type: "endurance", pattern: /\b(endurance|cardio|run|running|stamina|marathon)\b/i },
];
const SHORT_REPLY_PATTERN = /^[a-z0-9\s,'".+-]{1,80}$/i;
const DIETARY_PATTERN = /\b(vegetarian|vegan|eggetarian|non[\s-]?vegetarian|high protein|low carb|keto|jain)\b/i;
const SCHEDULE_PATTERN = /\b(\d)\s*(day|days)\b|\b(home|gym)\b|\b(beginner|intermediate|advanced)\b/i;
const TARGET_PATTERN = /(?:lose|gain|reach|target|drop|add)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms|lb|lbs|pounds)?/i;

function detectGoalAction(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  if (GOAL_LOOKUP_PATTERN.test(text)) return "lookup";
  if (GOAL_PROGRESS_PATTERN.test(text)) return "progress";
  if (GOAL_CREATE_PATTERN.test(text)) return "create";
  return null;
}

function inferGoalType(text = "") {
  for (const entry of GOAL_TYPE_PATTERNS) {
    if (entry.pattern.test(text)) return entry.type;
  }
  return "general";
}

function extractGoalPayload(message, profile, basePayload = {}) {
  const text = String(message || "").toLowerCase();
  const payload = {
    ...basePayload,
    type: normalizeGoalType(basePayload.type || inferGoalType(text)),
    target: { ...(basePayload.target || {}) },
    preferences: { ...(basePayload.preferences || {}) },
    constraints: { ...(basePayload.constraints || {}) },
  };

  // Try to extract a numeric target (e.g., "lose 10 kg", "target 70 kg").
  const targetMatch = text.match(TARGET_PATTERN);
  if (targetMatch) {
    payload.target.targetValue = Number(targetMatch[1]);
    payload.target.unit = targetMatch[2]?.toLowerCase().includes("lb") ? "lb" : "kg";
  }

  if (DIETARY_PATTERN.test(text)) {
    payload.preferences.dietaryPreference = text.match(DIETARY_PATTERN)?.[0] || null;
  }

  if (/\b(home|gym)\b/i.test(text)) {
    payload.preferences.workoutLocation = text.match(/\b(home|gym)\b/i)?.[0]?.toLowerCase() || null;
  }

  const daysMatch = text.match(/\b([2-7])\s*days?\b/i);
  if (daysMatch) {
    payload.preferences.daysPerWeek = Number(daysMatch[1]);
  }

  // Seed current value from profile if available.
  if (profile?.weight && payload.target.currentValue == null) {
    payload.target.currentValue = Number(profile.weight);
  }
  if (profile?.weight && payload.target.startValue == null) {
    payload.target.startValue = Number(profile.weight);
  }
  if (profile?.targetWeight && payload.target.targetValue == null) {
    payload.target.targetValue = Number(profile.targetWeight);
  }

  if (!payload.title) payload.title = String(message || "").trim();
  return payload;
}

function normalizeGoalType(type) {
  return ["weight_loss", "muscle_gain", "nutrition", "endurance", "general"].includes(type)
    ? type
    : "general";
}

function detectMissingFields(payload, profile) {
  const missingFields = [];
  const goalType = normalizeGoalType(payload.type);
  const hasWeight = Number.isFinite(Number(profile?.weight)) || Number.isFinite(Number(payload.target?.currentValue));
  const hasTarget = Number.isFinite(Number(payload.target?.targetValue));

  if (goalType === "nutrition" && !payload.preferences?.dietaryPreference && !profile?.dietaryPreference) {
    missingFields.push("dietaryPreference");
  }

  if ((goalType === "weight_loss" || goalType === "muscle_gain") && !hasWeight) {
    missingFields.push("currentWeight");
  }

  if ((goalType === "weight_loss" || goalType === "muscle_gain") && !hasTarget) {
    missingFields.push("targetValue");
  }

  if (goalType !== "nutrition" && !payload.preferences?.daysPerWeek && !profile?.activityLevel) {
    missingFields.push("schedulePreference");
  }

  return missingFields;
}

function buildClarifyingQuestions(goalType, missingFields) {
  const prompts = [];

  if (missingFields.includes("dietaryPreference")) {
    prompts.push("What kind of food preference should I follow, such as vegetarian, vegan, or non-vegetarian?");
  }
  if (missingFields.includes("currentWeight")) {
    prompts.push("What is your current weight right now?");
  }
  if (missingFields.includes("targetValue")) {
    prompts.push(goalType === "weight_loss"
      ? "How much weight do you want to lose, or what target weight should I plan for?"
      : "What target weight or muscle-gain target should I use?");
  }
  if (missingFields.includes("schedulePreference")) {
    prompts.push("How many days per week do you want to train, and will this be at home or in a gym?");
  }

  return prompts.slice(0, 2);
}

function buildDraftGoalContext(draft) {
  const questions = Array.isArray(draft.questions) ? draft.questions : [];
  return [
    "=== GOAL DRAFT ===",
    `Goal request: ${draft.payload?.title || "New goal request"}`,
    `Goal type: ${draft.payload?.type || "general"}`,
    `Missing fields: ${(draft.missingFields || []).join(", ") || "none"}`,
    "",
    "The user is in the middle of creating a goal. Ask only the missing clarification questions below, be concise, and do not generate the full plan yet.",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join("\n");
}

function mergeDraftFromReply(draft, message, profile) {
  const text = String(message || "").trim();
  if (!text || !SHORT_REPLY_PATTERN.test(text)) {
    return { ...(draft.payload || {}) };
  }

  const mergedPayload = extractGoalPayload(text, profile, draft.payload || {});

  if ((draft.missingFields || []).includes("dietaryPreference") && DIETARY_PATTERN.test(text)) {
    mergedPayload.preferences = {
      ...(mergedPayload.preferences || {}),
      dietaryPreference: text.match(DIETARY_PATTERN)?.[0]?.toLowerCase() || mergedPayload.preferences?.dietaryPreference,
    };
  }

  if ((draft.missingFields || []).includes("schedulePreference") && SCHEDULE_PATTERN.test(text)) {
    const daysMatch = text.match(/\b([2-7])\s*days?\b/i);
    mergedPayload.preferences = {
      ...(mergedPayload.preferences || {}),
      daysPerWeek: daysMatch ? Number(daysMatch[1]) : mergedPayload.preferences?.daysPerWeek,
      workoutLocation:
        text.match(/\b(home|gym)\b/i)?.[0]?.toLowerCase() || mergedPayload.preferences?.workoutLocation,
    };
  }

  if ((draft.missingFields || []).includes("currentWeight")) {
    const currentMatch =
      text.match(/(?:i weigh|weight is|currently)\s+(\d+(?:\.\d+)?)/i) ||
      text.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs|pounds)/i);
    if (currentMatch) {
      mergedPayload.target = {
        ...(mergedPayload.target || {}),
        currentValue: Number(currentMatch[1]),
        startValue: Number(currentMatch[1]),
        unit: currentMatch[2]?.toLowerCase().includes("lb") ? "lb" : mergedPayload.target?.unit || "kg",
      };
    }
  }

  return mergedPayload;
}

function buildGoalActionContext(goal, goalAction) {
  const base = formatGoalForContext(goal);
  if (!goalAction) return base;

  if (goalAction.kind === "created") {
    const nextMessage = goalAction.next?.message || "Guide the user into the first step.";
    return `${base}\n\n=== GOAL ACTION ===\nA new goal was created in this turn.\n${nextMessage}`;
  }

  if (goalAction.kind === "lookup" && goalAction.next?.message) {
    return `${base}\n\n=== GOAL ACTION ===\n${goalAction.next.message}`;
  }

  if (goalAction.kind === "progress_updated") {
    return `${base}\n\n=== GOAL ACTION ===\nA progress update was recorded this turn. Reinforce the updated progress and recommend the next concrete action.`;
  }

  return base;
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

  let draft = null;
  try {
    draft = await goalCache.getGoalDraft(userId);
  } catch (error) {
    console.error("[Graph:goal] Failed to load goal draft:", error?.message || error);
  }

  // Detect a goal-related action from the message.
  const action = detectGoalAction(originalMessage);
  let goalAction = null;

  if (draft?.payload) {
    try {
      const mergedPayload = mergeDraftFromReply(draft, originalMessage, profile);
      const missingFields = detectMissingFields(mergedPayload, profile);

      if (missingFields.length === 0) {
        activeGoal = await createGoal(userId, mergedPayload);
        const next = await planNextStep(userId, activeGoal);
        goalAction = { kind: "created", goal: activeGoal, resumedFromDraft: true, next };
        emitEvent(state, "goal.created", {
          userId,
          goalType: activeGoal.type,
          title: activeGoal.title,
          resumedFromDraft: true,
          nextStep: next?.step?.title || null,
        });
      } else {
        draft = {
          ...draft,
          payload: mergedPayload,
          missingFields,
          questions: buildClarifyingQuestions(mergedPayload.type, missingFields),
          updatedAt: new Date().toISOString(),
        };
        await goalCache.setGoalDraft(userId, draft);
        goalAction = { kind: "draft", draft };
        emitEvent(state, "goal.draft.updated", {
          userId,
          goalType: mergedPayload.type,
          missingFields,
        });
      }
    } catch (error) {
      console.error("[Graph:goal] Goal draft resume failed:", error?.message || error);
    }
  } else if (action) {
    try {
      if (action === "create") {
        const payload = extractGoalPayload(originalMessage, profile);
        const missingFields = detectMissingFields(payload, profile);

        if (missingFields.length > 0) {
          draft = {
            payload,
            missingFields,
            questions: buildClarifyingQuestions(payload.type, missingFields),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await goalCache.setGoalDraft(userId, draft);
          goalAction = { kind: "draft", draft };
          emitEvent(state, "goal.draft.saved", {
            userId,
            goalType: payload.type,
            missingFields,
          });
        } else {
          activeGoal = await createGoal(userId, payload);
          const next = await planNextStep(userId, activeGoal);
          goalAction = { kind: "created", goal: activeGoal, next };
          emitEvent(state, "goal.created", {
            userId,
            goalType: activeGoal.type,
            title: activeGoal.title,
            nextStep: next?.step?.title || null,
          });
        }
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
    goalContext:
      goalAction?.kind === "draft"
        ? buildDraftGoalContext(goalAction.draft)
        : buildGoalActionContext(activeGoal, goalAction),
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
