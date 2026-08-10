// src/ai/graph/fitness/nodes/retrieveContextNode.js

import { buildSmartContext } from "../../../search/semanticMemoryRetrieval.js";
import { fetchNutritionFromUSDA } from "../../../tools/nutritionTool.js";
import { shouldSkipRag } from "../policies.js";
import {
  buildLongTermMemoryContext,
} from "../../../../services/memoryManager.js";

const emitEvent = (state, type, payload) => {
  if (typeof state?.onEvent === "function") {
    try {
      state.onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:context] onEvent failed for ${type}:`, error?.message || error);
    }
  }
};

/**
 * Fetch long-term memory (vector recall + durable facts) for the current user
 * and attach it to the user context so it can be injected into the prompt.
 */
async function buildLongTermMemory(userId, query) {
  if (!userId) {
    return { memoryProfile: null, recalled: { results: [], source: "none" }, text: "" };
  }

  try {
    return await buildLongTermMemoryContext(userId, query);
  } catch (error) {
    console.error("[Graph:context] Long-term memory retrieval failed:", error?.message || error);
    return { memoryProfile: null, recalled: { results: [], source: "none" }, text: "" };
  }
}

export async function retrieveContextNode(state) {
  const { userId, originalMessage, intent } = state;
  const t0 = Date.now();

  if (shouldSkipRag(intent)) {
    console.log("[Graph:context] RAG SKIPPED (simple intent - no DB query needed)");

    emitEvent(state, "ai.context.resolved", {
      userId,
      skipped: true,
      reason: "simple intent - no DB query needed",
      durationMs: 0,
    });

    return {
      userContext: {
        profile: { name: "User" },
        dietPlan: null,
        workoutPlan: null,
        conversationHistory: [],
      },
      longTermMemory: { text: "", source: "none" },
      memoryHits: [],
      flowMetrics: { contextRetrievalTime: 0 },
    };
  }

  console.log("[Graph:context] Retrieving smart context (RAG + MongoDB + long-term memory)...");

  const foodsToFetch =
    intent.intent === "plan_modification" &&
    Array.isArray(intent.entities?.foods) &&
    intent.entities.foods.length > 0
      ? intent.entities.foods
      : [];

  if (foodsToFetch.length > 0) {
    console.log(
      `[Graph:context] Pre-fetching USDA nutrition (parallel with RAG) for: ${foodsToFetch.join(", ")}`
    );
  }

  const [userContext, nutritionResults, longTerm] = await Promise.all([
    buildSmartContext(userId, originalMessage, intent),
    Promise.all(
      foodsToFetch.map(async (food) => {
        const data = await fetchNutritionFromUSDA(food);
        return data ? { food, ...data } : null;
      })
    ),
    buildLongTermMemory(userId, originalMessage),
  ]);

  const fetched = nutritionResults.filter(Boolean);
  if (fetched.length > 0) {
    userContext.preloadedNutrition = fetched;
    console.log(
      `[Graph:context] USDA pre-fetch done: ${fetched.map((f) => f.food).join(", ")}`
    );
  } else if (foodsToFetch.length > 0) {
    console.log(
      "[Graph:context] USDA pre-fetch returned no results - LLM will use built-in knowledge"
    );
  }

  // Attach long-term memory to the user context for prompt injection.
  userContext.longTermMemoryText = longTerm.text;
  userContext.memoryProfile = longTerm.memoryProfile;

  const memoryHits = (longTerm.recalled?.results || []).map((r) => ({
    type: r.type || "memory",
    content: r.content,
    score: r.score,
  }));

  // Notify the event consumers about memory retrieval outcome.
  emitEvent(state, "memory.vector.retrieved", {
    userId,
    source: longTerm.recalled?.source || "none",
    resultCount: (longTerm.recalled?.results || []).length,
    cacheHit: longTerm.recalled?.cacheHit || false,
  });

  const elapsed = Date.now() - t0;
  console.log(`[Graph:context] Context ready in ${elapsed} ms`);
  console.log(
    `[Graph:context] Long-term memory: ${memoryHits.length} hit(s) from ${longTerm.recalled?.source || "none"}`
  );

  emitEvent(state, "ai.context.resolved", {
    userId,
    skipped: false,
    durationMs: elapsed,
    hasProfile: Boolean(userContext?.profile),
    hasDietPlan: Boolean(userContext?.dietPlan),
    hasWorkoutPlan: Boolean(userContext?.workoutPlan),
    historyLength: Array.isArray(userContext?.conversationHistory)
      ? userContext.conversationHistory.length
      : 0,
    preloadedNutritionCount: Array.isArray(userContext?.preloadedNutrition)
      ? userContext.preloadedNutrition.length
      : 0,
    memoryHitCount: memoryHits.length,
    memorySource: longTerm.recalled?.source || "none",
  });

  return {
    userContext,
    longTermMemory: { text: longTerm.text, source: longTerm.recalled?.source || "none" },
    memoryHits,
    flowMetrics: { contextRetrievalTime: elapsed },
  };
}
