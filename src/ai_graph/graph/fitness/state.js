// src/ai/graph/fitness/state.js

import { Annotation } from "@langchain/langgraph";

function addMessages(existing, incoming) {
  const left = Array.isArray(existing) ? existing : existing ? [existing] : [];
  const right = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
  return [...left, ...right];
}

function mergeObjects(existing, incoming) {
  return { ...(existing ?? {}), ...(incoming ?? {}) };
}

function appendArray(existing, incoming) {
  return [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
}

const lastWrite = (_, x) => x;

export const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: addMessages,
    default: () => [],
  }),

  userId: Annotation({ reducer: lastWrite, default: () => "" }),
  originalMessage: Annotation({ reducer: lastWrite, default: () => "" }),
  files: Annotation({ reducer: lastWrite, default: () => null }),
  conversationHistory: Annotation({ reducer: lastWrite, default: () => [] }),
  profile: Annotation({ reducer: lastWrite, default: () => null }),

  intent: Annotation({ reducer: lastWrite, default: () => null }),
  queryType: Annotation({ reducer: lastWrite, default: () => null }),
  needsRag: Annotation({ reducer: lastWrite, default: () => false }),
  greetingResponse: Annotation({ reducer: lastWrite, default: () => "" }),
  userContext: Annotation({ reducer: lastWrite, default: () => null }),
  enableSearch: Annotation({ reducer: lastWrite, default: () => false }),

  // Long-term (cross-session) memory injected during context retrieval.
  longTermMemory: Annotation({ reducer: lastWrite, default: () => null }),
  memoryHits: Annotation({ reducer: lastWrite, default: () => [] }),

toolsUsed: Annotation({ reducer: appendArray, default: () => [] }),
  startTime: Annotation({ reducer: lastWrite, default: () => 0 }),
  flowMetrics: Annotation({ reducer: mergeObjects, default: () => ({}) }),

// Goal-based agent state: the user's active goal, loaded during context
  // retrieval and injected into the prompt so the assistant reasons in the
  // context of the user's objective rather than in a vacuum.
  activeGoal: Annotation({ reducer: lastWrite, default: () => null }),
  goalAction: Annotation({ reducer: lastWrite, default: () => null }),

  // Per-turn agent plan (goal + task breakdown + next action) computed by the
  // cost-efficient turn planner. Injected into the prompt so the LLM drives a
  // structured, goal-oriented conversation and supports pause/resume.
  turnPlan: Annotation({ reducer: lastWrite, default: () => null }),

  // Callback used by graph nodes to push AI lifecycle events to the
  // request caller (e.g. forwarded to the frontend via SSE).
  onEvent: Annotation({ reducer: lastWrite, default: () => null }),
});
