// src/ai/graph/fitness/edges.js

import { END } from "@langchain/langgraph";
import { QueryType } from "../../reasoning/intentRouter.js";

export function routeAfterClassify(state) {
  const { queryType, intent } = state;

  if (queryType === QueryType.GREETING || queryType === QueryType.OFF_TOPIC) {
    console.log(
      `[Graph:route] classify -> greeting (instant response - intent: ${intent?.intent})`
    );
    return "greeting";
  }

  if (queryType === QueryType.GENERAL_FITNESS) {
    if (intent?.directAnswerable) {
      console.log(
        `[Graph:route] classify -> directGeneral (simple general query answered from classifier - intent: ${intent?.intent})`
      );
      return "directGeneral";
    }

    console.log(
      `[Graph:route] classify -> buildSimplePrompt (general query via small model - intent: ${intent?.intent})`
    );
    return "general";
  }

  console.log(
    `[Graph:route] classify -> retrieveContext (personalized query with RAG/tools - intent: ${intent?.intent})`
  );
  return "personalized";
}

// Maximum number of llm->tools->llm cycles before the graph forces a final
// answer. This guards against a model (e.g. a free/small model) that keeps
// requesting tools without ever producing a final text response, which would
// otherwise loop until LangGraph's recursion limit is hit.
const MAX_TOOL_LOOPS = Number(process.env.MAX_TOOL_LOOPS || 5);

export function shouldContinueToTools(state) {
  const last = state.messages.at(-1);
  const hasCalls = Array.isArray(last?.tool_calls) && last.tool_calls.length > 0;

  if (!hasCalls) {
    console.log("[Graph:edge] llm -> END (final response)");
    return END;
  }

  const loopCount = Number(state.toolLoopCount) || 0;
  if (loopCount >= MAX_TOOL_LOOPS) {
    console.warn(
      `[Graph:edge] Tool loop limit reached (${loopCount}/${MAX_TOOL_LOOPS}). ` +
        "Forcing final response to avoid infinite tool-calling recursion."
    );
    return END;
  }

  console.log(
    `[Graph:edge] llm -> tools (${last.tool_calls.length} call(s), loop ${loopCount}/${MAX_TOOL_LOOPS})`
  );
  return "tools";
}
