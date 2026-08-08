// src/ai/graph/fitness/nodes/llmNode.js

import { AIMessage } from "@langchain/core/messages";
import { QueryType } from "../../../reasoning/intentRouter.js";
import { createStreamingLLM, createLLMWithSearch, createGroqLLM } from "../../../config/llmconfig.js";
import { getSearchGroundingConfig } from "../../../config/searchGrounding.js";
import { createGraphTools } from "../tools/index.js";
import { getExcludedTools } from "../policies.js";

function isStreamParseError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("failed to parse stream");
}

function hasImageContent(messages) {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "image_url" || block.image_url) {
          return true;
        }
      }
    }
  }
  return false;
}

const emitEvent = (state, type, payload) => {
  if (typeof state?.onEvent === "function") {
    try {
      state.onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:llm] onEvent failed for ${type}:`, error?.message || error);
    }
  }
};

function logResponseSummary(response) {
  const toolCallCount = response.tool_calls?.length ?? 0;
  if (toolCallCount > 0) {
    const names = response.tool_calls.map((tc) => tc.name).join(", ");
    console.log(`[Graph:llm] -> Requesting tools: ${names}`);
    return;
  }

  const chars =
    typeof response.content === "string"
      ? response.content.length
      : JSON.stringify(response.content ?? "").length;
  console.log(`[Graph:llm] -> Final response generated (${chars} chars)`);
}

export async function llmNode(state) {
  const { messages, enableSearch, queryType, intent, userContext, userId } = state;

  const isGeneralPath = queryType === QueryType.GENERAL_FITNESS;

  emitEvent(state, "ai.model.thinking", {
    userId,
    queryType: String(queryType),
    intent: intent?.intent,
    enableSearch,
    toolCount: isGeneralPath ? 0 : createGraphTools([]).length,
    messageCount: messages.length,
  });

  if (isGeneralPath) {
    console.log("[Graph:llm] GENERAL path - small model without tools");
  }

  const excludedTools = getExcludedTools({
    enableSearch,
    queryType,
    intent,
    userContext,
  });

  if (intent?.intent === "plan_modification" && excludedTools.includes("fetch_details")) {
    console.log("[Graph:llm] plan_modification - fetch_details excluded (planId preloaded)");
  }

  if (
    intent?.intent === "plan_modification" &&
    excludedTools.includes("nutrition_lookup") &&
    !enableSearch
  ) {
    console.log(
      "[Graph:llm] plan_modification - nutrition_lookup excluded (all foods preloaded)"
    );
  }

  let tools = [];
  let llm;
  let runner;

  const hasImage = hasImageContent(messages);

  if (isGeneralPath) {
    if (hasImage) {
      llm = createStreamingLLM(true, {
        model:
          process.env.GENERAL_QUERY_MODEL?.trim() ||
          "gemini-2.5-flash",
        temperature: 0.2,
        maxRetries: 0,
      });
      console.log("[Graph:llm] Using Gemini for GENERAL path (multimodal)");
    } else {
      llm = createGroqLLM(true, {
        model:
          process.env.GROQ_GENERAL_MODEL?.trim() ||
          "llama-3.1-8b-instant",
        temperature: 0.2,
        maxRetries: 0,
      });
      console.log("[Graph:llm] Using Groq for GENERAL path");
    }
    runner = llm;
  } else {
    tools = createGraphTools(excludedTools);

    if (enableSearch) {
      const searchConfig = getSearchGroundingConfig({ threshold: 0.7 });
      llm = createLLMWithSearch(true, searchConfig);
      console.log("[Graph:llm] Using Gemini + Google Search grounding");
    } else if (hasImage) {
      llm = createStreamingLLM(true);
      console.log("[Graph:llm] Using standard Gemini 2.5 Flash (multimodal)");
    } else {
      llm = createGroqLLM(true, {
        model:
          process.env.GROQ_MAIN_MODEL?.trim() ||
          "llama-3.3-70b-versatile",
        temperature: 0.2,
      });
      console.log("[Graph:llm] Using Groq (Llama 3.3 70B) for text reasoning");
    }

    runner = llm.bindTools(tools);
  }

  console.log(`[Graph:llm] Invoking - ${tools.length} tools bound, ${messages.length} messages`);

  try {
    const response = await runner.invoke(messages);
    logResponseSummary(response);

    const toolCalls = response.tool_calls?.length ? response.tool_calls : [];
    if (toolCalls.length > 0) {
      emitEvent(state, "ai.tool.requested", {
        userId,
        tools: toolCalls.map((tc) => tc.name),
        queryType: String(queryType),
        intent: intent?.intent,
      });
    } else {
      emitEvent(state, "ai.model.completed", {
        userId,
        queryType: String(queryType),
        intent: intent?.intent,
        hasToolCalls: false,
      });
    }

    return { messages: [response] };
  } catch (error) {
    if (!isStreamParseError(error)) {
      throw error;
    }

    console.warn("[Graph:llm] Stream parse failed. Retrying once with non-streaming mode...");

    try {
      let retryRunner;

      if (isGeneralPath) {
        if (hasImage) {
          const retryLlm = createStreamingLLM(false, {
            model:
              process.env.GENERAL_QUERY_MODEL?.trim() ||
              "gemini-2.5-flash",
            temperature: 0.2,
            maxRetries: 0,
          });
          retryRunner = retryLlm;
        } else {
          const retryLlm = createGroqLLM(false, {
            model:
              process.env.GROQ_GENERAL_MODEL?.trim() ||
              "llama-3.1-8b-instant",
            temperature: 0.2,
            maxRetries: 0,
          });
          retryRunner = retryLlm;
        }
      } else {
        let retryLlm;
        if (enableSearch) {
          retryLlm = createLLMWithSearch(false, getSearchGroundingConfig({ threshold: 0.7 }));
        } else if (hasImage) {
          retryLlm = createStreamingLLM(false);
        } else {
          retryLlm = createGroqLLM(false, {
            model:
              process.env.GROQ_MAIN_MODEL?.trim() ||
              "llama-3.3-70b-versatile",
            temperature: 0.2,
          });
        }
        retryRunner = retryLlm.bindTools(tools);
      }

      const retryResponse = await retryRunner.invoke(messages);
      console.log("[Graph:llm] Non-streaming retry succeeded");
      logResponseSummary(retryResponse);
      return { messages: [retryResponse] };
    } catch (retryError) {
      console.error(`[Graph:llm] Non-streaming retry failed: ${retryError.message}`);

      const classifierFallback = intent?.classifierResponse?.trim();
      if (classifierFallback) {
        console.warn("[Graph:llm] Falling back to classifier response after model failure");
        return { messages: [new AIMessage({ content: classifierFallback })] };
      }

      const safeFallback = new AIMessage({
        content:
          "I hit a temporary model streaming issue. Please resend your message and I will answer right away.",
      });

      return { messages: [safeFallback] };
    }
  }
}
