// src/services/turnPlanner.js
// Cost-efficient, goal-based turn planner for the Coachlix agent.
//
// Turns a single user message into a small actionable plan (goal + task
// breakdown + next action) so the assistant always drives a structured,
// goal-oriented conversation. To keep latency and token cost low, planning is
// deliberately TIERED:
//
//   Tier 0 (no LLM):  A cached turn plan exists AND the user replied with a
//                     short answer / affirmation -> RESUME the cached plan and
//                     merge the new info. No planner LLM call.
//   Tier 1 (no LLM):  The message clearly matches a known goal type via fast
//                     patterns -> build the breakdown from templates.
//   Tier 2 (small LLM): Ambiguous / complex requests -> one cheap Gemini lite
//                     call to infer the goal + breakdown.
//
// Pause / resume: plans live in Redis (like the goal draft). When we need a
// clarification we set status = 'awaiting_input' and a pendingQuestion; the
// assistant pauses and asks it. On the next turn the plan is resumed from
// cache and merged, so we never re-plan an in-flight goal.

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createStreamingLLM } from "../ai_graph/config/llmconfig.js";

// ── Heuristic gates (fast, no LLM) ──────────────────────────────────────

const SHORT_ANSWER_PATTERN =
  /^(yes|yeah|yep|yup|sure|ok|okay|okayy?|alright|fine|go\s*ahead|please\s*(do|go)|let'?s\s*(do|go|start|begin)|do\s*it|start|begin|absolutely|definitely|correct|right|no|nope|nah|not\s*now|skip|later)\b[\s!.?]*$/i;

const GREETING_PATTERN =
  /^(hi|hello|hey|hii+|heyy+|yo|sup|hola|namaste|good\s+(morning|afternoon|evening|night))[\s!.?]*$/i;

const SIMPLE_GENERAL_LEAD_PATTERN =
  /^(what is|what's|what are|who is|who are|define|meaning of|benefits of|benefit of|how much|how many|is|are)\b/i;
const SIMPLE_GENERAL_TOPIC_PATTERN =
  /\b(protein|calorie|calories|bmi|hydration|water|steps|sleep|soreness|muscle|fat|carb|carbs|exercise|workout)\b/i;
const COMPLEX_GENERAL_PATTERN =
  /\b(compare|comparison|difference|versus|vs\.?|better than|recommend|suggest|custom|personaliz|plan|routine|program|schedule|design|build|create|optimize|should i|can i|for my|my plan|my workout|my diet)\b/i;

// Goal type patterns (mirrors goalService.goalNode heuristics).
const GOAL_TYPE_PATTERNS = [
  { type: "weight_loss", pattern: /\b(lose|loss|fat loss|cut|slim|drop)\b.*\b(weight|fat|kg|kilo|lb|lbs|pounds)?|\bweight loss\b/i },
  { type: "muscle_gain", pattern: /\b(gain|build|grow|bulk)\b.*\b(muscle|strength|mass)\b|\bmuscle gain\b/i },
  { type: "nutrition", pattern: /\b(diet|meal|nutrition|macro|macros|calorie|protein|vegetarian|vegan|food)\b/i },
  { type: "endurance", pattern: /\b(endurance|cardio|run|running|stamina|marathon)\b/i },
];

const EXERCISE_LOOKUP_PATTERN =
  /\b(how to|form|technique|do i do|guide|guidance|exercise|squat|push.?up|deadlift|bench|curl|row|lunge|plank)\b/i;
const FOOD_LOOKUP_PATTERN =
  /\b(food|meal|recipe|eat|protein|nutrition|diet|snack|breakfast|lunch|dinner)\b/i;

// Template task plans per goal type (used for Tier 1 - no LLM).
function buildTemplatePlan(type, message) {
  const base = {
    goal: null,
    taskBreakdown: [],
    nextAction: "",
    missingInfo: [],
    suggestCreateGoal: false,
  };

  if (type === "weight_loss") {
    base.goal = "Support the user's weight-loss objective";
    base.taskBreakdown = [
      { title: "Assess starting point", action: "Confirm current weight and target", tool: "profile", status: "pending" },
      { title: "Calorie discipline", action: "Provide a moderate deficit guideline", tool: "diet", status: "pending" },
      { title: "Training plan", action: "Suggest 3-4 weekly workouts", tool: "workout", status: "pending" },
      { title: "Track & check-in", action: "Set weekly weigh-in milestone", tool: "goal", status: "pending" },
    ];
    base.nextAction = base.taskBreakdown[0].action;
    base.missingInfo = ["currentWeight", "targetValue"];
    base.suggestCreateGoal = true;
  } else if (type === "muscle_gain") {
    base.goal = "Support the user's muscle-gain objective";
    base.taskBreakdown = [
      { title: "Assess baseline", action: "Confirm current stats and strength", tool: "profile", status: "pending" },
      { title: "Progressive overload", action: "Suggest a structured resistance routine", tool: "workout", status: "pending" },
      { title: "Protein target", action: "Set a daily protein intake target", tool: "diet", status: "pending" },
      { title: "Monthly review", action: "Plan a strength reassessment", tool: "goal", status: "pending" },
    ];
    base.nextAction = base.taskBreakdown[0].action;
    base.missingInfo = ["currentWeight", "targetValue"];
    base.suggestCreateGoal = true;
  } else if (type === "nutrition") {
    base.goal = "Guide the user on nutrition / food";
    base.taskBreakdown = [
      { title: "Understand preference", action: "Clarify dietary preference & goal", tool: "profile", status: "pending" },
      { title: "Provide food guidance", action: "Give practical food/meal suggestions", tool: "diet", status: "pending" },
      { title: "Track macros", action: "Suggest a simple macro target", tool: "diet", status: "pending" },
    ];
    base.nextAction = base.taskBreakdown[0].action;
    base.missingInfo = ["dietaryPreference"];
    base.suggestCreateGoal = false;
  } else if (type === "endurance") {
    base.goal = "Support the user's endurance objective";
    base.taskBreakdown = [
      { title: "Assess baseline", action: "Confirm current cardio performance", tool: "profile", status: "pending" },
      { title: "Build base", action: "Suggest steady-state cardio 3x/week", tool: "workout", status: "pending" },
      { title: "Progress review", action: "Plan a re-test milestone", tool: "goal", status: "pending" },
    ];
    base.nextAction = base.taskBreakdown[0].action;
    base.missingInfo = ["currentValue"];
    base.suggestCreateGoal = true;
  } else {
    // Directional request (exercise form / food guidance without a typed goal).
    const isExercise = EXERCISE_LOOKUP_PATTERN.test(message);
    const isFood = FOOD_LOOKUP_PATTERN.test(message);
    base.goal = isExercise
      ? "Teach the requested exercise with correct form"
      : isFood
        ? "Provide practical food/nutrition guidance"
        : "Help the user with their fitness request";
    base.taskBreakdown = [
      { title: "Understand the request", action: "Clarify specifics of what they want", tool: "general", status: "pending" },
      { title: "Deliver guidance", action: isExercise ? "Explain technique + safety cues" : isFood ? "Give concrete food suggestions" : "Answer the request directly", tool: "general", status: "pending" },
      { title: "Offer next step", action: "Suggest a related follow-up or extended plan", tool: "goal", status: "pending" },
    ];
    base.nextAction = base.taskBreakdown[0].action;
    base.missingInfo = [];
    base.suggestCreateGoal = false;
  }

  return base;
}

function inferGoalType(message) {
  const text = String(message || "").toLowerCase();
  for (const entry of GOAL_TYPE_PATTERNS) {
    if (entry.pattern.test(text)) return entry.type;
  }
  return null;
}

// ── Tier gating ─────────────────────────────────────────────────────────

/**
 * Decide which planning tier applies. Returns 'resume' | 'skip' | 'heuristic'
 * | 'llm'. Keeps LLM planner calls minimal.
 */
export function decidePlanningTier({ message, hasCachedPlan, greetingOnly, simpleGeneral, offTopic }) {
  const text = String(message || "").trim();

  if (offTopic || !text) return "skip";
  if (greetingOnly) return "skip";
  if (simpleGeneral) return "skip";

  // Tier 0: resume an in-flight plan when the user gives a short answer.
  if (hasCachedPlan && SHORT_ANSWER_PATTERN.test(text)) return "resume";

  // Tier 1: clearly typed goal -> build from template, no LLM.
  if (inferGoalType(text)) return "heuristic";

  // Directional but specific (exercise/food guidance) -> heuristic template.
  if (EXERCISE_LOOKUP_PATTERN.test(text) || FOOD_LOOKUP_PATTERN.test(text)) return "heuristic";

  // Tier 2: complex / ambiguous -> one small LLM call.
  if (COMPLEX_GENERAL_PATTERN.test(text)) return "llm";

  return "skip";
}

// ── Pause / resume helpers ──────────────────────────────────────────────

const activeTurnKey = (userId) => `turn:active:${userId}`;

// ── LLM planner (Tier 2) ────────────────────────────────────────────────

const TURN_PLANNER_SYSTEM_PROMPT = `You are the planning brain of a fitness AI agent.
Given the user's message, the active long-term goal (if any), and recent context,
produce a concise immediate plan to solve THIS specific request.

Output STRICT JSON:
{
  "goal": "one-line immediate goal for this request",
  "taskBreakdown": [ { "title": "short step", "action": "concrete action", "tool": "profile|diet|workout|goal|general" } ],
  "nextAction": "the single concrete next step to drive the user toward",
  "missingInfo": ["field|description of missing info"],
  "suggestCreateGoal": true/false,
  "pendingQuestion": "one concise clarifying question, or empty string if none"
}

Rules:
- Keep taskBreakdown to 2-4 concise steps.
- Align with the active long-term goal if one exists; otherwise infer intent.
- If we lack info to proceed, set pendingQuestion to a SINGLE question and leave
  taskBreakdown short.
- Do NOT invent user data. Output only JSON.`;

async function planWithLlm(message, context) {
  const plannerLlm = createStreamingLLM(false, {
    model:
      process.env.TURN_PLANNER_MODEL?.trim() ||
      process.env.INTENT_CLASSIFIER_MODEL?.trim() ||
      "gemini-2.5-flash-lite",
    temperature: 0,
    maxOutputTokens: 400,
    topP: 0.1,
    topK: 1,
    maxRetries: 0,
  });

  const contextText = [
    context.activeGoal ? `Active long-term goal: ${context.activeGoal}` : "",
    context.profile ? `Profile: weight=${context.profile.weight}, goal=${context.profile.fitnessGoal}` : "",
    context.recentHistory ? `Recent history: ${context.recentHistory}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userInput = contextText
    ? `CONTEXT:\n${contextText}\n\nUSER MESSAGE:\n${message || ""}`
    : message || "";

  const output = await plannerLlm.invoke([
    new SystemMessage(TURN_PLANNER_SYSTEM_PROMPT),
    new HumanMessage(userInput),
  ]);

  const rawText =
    typeof output?.content === "string"
      ? output.content
      : JSON.stringify(output?.content ?? "");

  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first === -1 || last <= first) return null;

  try {
    return JSON.parse(rawText.slice(first, last + 1));
  } catch {
    return null;
  }
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * Produce a turn plan for a user message. Runs the cheapest tier that
 * satisfies the request.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.message       latest user message
 * @param {Object|null} opts.activeGoal
 * @param {Object|null} opts.profile
 * @param {string} opts.recentHistory  short recent-history string (optional)
 * @param {Object|null} opts.cachedPlan cached turn plan (optional)
 * @returns {Promise<Object>} turnPlan
 */
export async function inferTurnGoal({
  userId,
  message,
  activeGoal = null,
  profile = null,
  recentHistory = "",
  cachedPlan = null,
}) {
  const text = String(message || "").trim();
  const hasCachedPlan = Boolean(cachedPlan?.id);

  const greetingOnly = GREETING_PATTERN.test(text);
  const simpleGeneral =
    SIMPLE_GENERAL_LEAD_PATTERN.test(text) &&
    SIMPLE_GENERAL_TOPIC_PATTERN.test(text) &&
    !COMPLEX_GENERAL_PATTERN.test(text);
  const offTopic = false; // caller decides; intent node already filters.

  const tier = decidePlanningTier({
    message: text,
    hasCachedPlan,
    greetingOnly,
    simpleGeneral,
    offTopic,
  });

  const now = new Date().toISOString();

  // Tier 0: resume an in-flight plan (no LLM).
  if (tier === "resume" && cachedPlan) {
    return {
      ...cachedPlan,
      status: "active",
      resumed: true,
      source: "resume",
      updatedAt: now,
      tier,
    };
  }

  // Tier 1: heuristic template (no LLM).
  if (tier === "heuristic" || tier === "skip") {
    const type = inferGoalType(text);
    const template = buildTemplatePlan(type || "general", text);
    return {
      id: `turn-${userId}-${Date.now()}`,
      status: "active",
      goal: template.goal,
      relatesToActiveGoal: Boolean(activeGoal),
      taskBreakdown: template.taskBreakdown,
      nextAction: template.nextAction,
      missingInfo: template.missingInfo,
      pendingQuestion: "",
      suggestCreateGoal: template.suggestCreateGoal,
      source: tier === "skip" ? "none" : "heuristic",
      tier,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Tier 2: LLM planner (small model, one call).
  const llmPlan = await planWithLlm(message, {
    activeGoal: activeGoal?.title,
    profile,
    recentHistory,
  }).catch(() => null);

  if (llmPlan) {
    const missing = Array.isArray(llmPlan.missingInfo) ? llmPlan.missingInfo : [];
    return {
      id: `turn-${userId}-${Date.now()}`,
      status: missing.length > 0 ? "awaiting_input" : "active",
      goal: String(llmPlan.goal || ""),
      relatesToActiveGoal: Boolean(activeGoal),
      taskBreakdown: (Array.isArray(llmPlan.taskBreakdown) ? llmPlan.taskBreakdown : []).slice(0, 4),
      nextAction: String(llmPlan.nextAction || ""),
      missingInfo: missing.slice(0, 3),
      pendingQuestion: String(llmPlan.pendingQuestion || ""),
      suggestCreateGoal: Boolean(llmPlan.suggestCreateGoal),
      source: "llm",
      tier,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Fallback if LLM fails: heuristic.
  const type = inferGoalType(text);
  const template = buildTemplatePlan(type || "general", text);
  return {
    id: `turn-${userId}-${Date.now()}`,
    status: "active",
    goal: template.goal,
    relatesToActiveGoal: Boolean(activeGoal),
    taskBreakdown: template.taskBreakdown,
    nextAction: template.nextAction,
    missingInfo: template.missingInfo,
    pendingQuestion: "",
    suggestCreateGoal: template.suggestCreateGoal,
    source: "heuristic-fallback",
    tier,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Cache helpers (delegated to goalCache) ──────────────────────────────

export const turnPlanKeys = {
  activeTurnKey,
  SHORT_ANSWER_PATTERN,
  GREETING_PATTERN,
  decidePlanningTier,
};

export default {
  inferTurnGoal,
  decidePlanningTier,
};
