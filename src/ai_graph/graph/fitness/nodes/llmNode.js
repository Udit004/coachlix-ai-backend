// src/ai/graph/fitness/nodes/llmNode.js

import { AIMessage } from "@langchain/core/messages";
import { QueryType } from "../../../reasoning/intentRouter.js";
import {
  createStreamingLLM,
  createGroqLLM,
  createNvidiaLLM,
  createOpenRouterLLM,
  createOpenRouterModelLLM,
  OPENROUTER_CONFIG,
} from "../../../config/llmconfig.js";
import { createGraphTools } from "../tools/index.js";
import { getExcludedTools } from "../policies.js";

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

/**
 * Rough token estimate: 1 token ~= 4 chars for English.
 * Sum characters of all message contents.
 */
function estimateTokens(messages) {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block.text === "string") chars += block.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
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

/**
 * Build an ordered list of { label, runner } fallback candidates from highest
 * to lowest quality. If a candidate throws (rate-limit, schema, network, etc)
 * the caller tries the next one so the request always completes if possible.
 *
 * @param {Object} opts
 * @param {boolean} opts.isGeneralPath
 * @param {boolean} opts.hasImage
 * @param {boolean} opts.enableSearch
 * @param {Array}   opts.tools - bound tool list (may be empty)
 * @returns {Array<{label:string, runner:any, streaming:boolean}>}
 */
function buildRunnerChain({ isGeneralPath, hasImage, enableSearch, tools, tokenSize }) {
  const chain = [];

  // Images/files MUST use a multimodal model (Gemini).
  if (hasImage) {
    chain.push({
      label: "gemini-2.5-flash",
      runner: createStreamingLLM(true),
      streaming: true,
    });
    return chain;
  }

  const bind = (llm) => (tools.length > 0 ? llm.bindTools(tools) : llm);

  if (isGeneralPath) {
    const bindGeneral = (llm) => (tools.length > 0 ? llm.bindTools(tools) : llm);
    chain.push({
      label: "groq-70b",
      runner: bindGeneral(
        createGroqLLM(true, {
          model: process.env.GROQ_GENERAL_MODEL?.trim() || "llama-3.3-70b-versatile",
          temperature: 0.2,
          maxRetries: 0,
        })
      ),
      streaming: true,
    });
    chain.push({
      label: "groq-8b",
      runner: bindGeneral(
        createGroqLLM(true, {
          model: process.env.GROQ_SMALL_MODEL?.trim() || "llama-3.1-8b-instant",
          temperature: 0.2,
          maxRetries: 0,
        })
      ),
      streaming: true,
    });
    return chain;
  }

  // Personalized / tool path: decide order based on tokenSize
  const SMALL_TOKEN_THRESHOLD = 2000; // tokens
  const hasOpenRouterKey = Boolean(OPENROUTER_CONFIG.apiKey);
  const hasNvidiaKey = Boolean(process.env.NVIDIA_API_KEY?.trim());

  const addIf = (cond, candidate) => cond && chain.push(candidate);

  if (tokenSize <= SMALL_TOKEN_THRESHOLD) {
    // Small context: prefer fast Groq
    chain.push({
      label: "groq-70b",
      runner: bind(
        createGroqLLM(true, {
          model: process.env.GROQ_MAIN_MODEL?.trim() || "llama-3.3-70b-versatile",
          temperature: 0.2,
        })
      ),
      streaming: true,
    });
    addIf(hasNvidiaKey, {
      label: "nvidia",
      runner: bind(createNvidiaLLM(true)),
      streaming: true,
    });
    chain.push({
      label: "gemini-2.5-flash",
      runner: bind(createStreamingLLM(true)),
      streaming: true,
    });
    if (hasOpenRouterKey) {
      chain.push({
        label: "openrouter",
        runner: bind(createOpenRouterLLM(true)),
        streaming: true,
      });
      for (const fbModel of OPENROUTER_CONFIG.fallbackModels || []) {
        if (fbModel !== OPENROUTER_CONFIG.model) {
          chain.push({
            label: `openrouter-${fbModel}`,
            runner: bind(createOpenRouterModelLLM(fbModel)),
            streaming: true,
          });
        }
      }
    }
  } else {
    // Large context: prioritize Gemini (larger context window), then Nvidia, then Groq, then OpenRouter
    chain.push({
      label: "gemini-2.5-flash",
      runner: bind(createStreamingLLM(true)),
      streaming: true,
    });
    addIf(hasNvidiaKey, {
      label: "nvidia",
      runner: bind(createNvidiaLLM(true)),
      streaming: true,
    });
    chain.push({
      label: "groq-70b",
      runner: bind(
        createGroqLLM(true, {
          model: process.env.GROQ_MAIN_MODEL?.trim() || "llama-3.3-70b-versatile",
          temperature: 0.2,
        })
      ),
      streaming: true,
    });
    if (hasOpenRouterKey) {
      chain.push({
        label: "openrouter",
        runner: bind(createOpenRouterLLM(true)),
        streaming: true,
      });
      for (const fbModel of OPENROUTER_CONFIG.fallbackModels || []) {
        if (fbModel !== OPENROUTER_CONFIG.model) {
          chain.push({
            label: `openrouter-${fbModel}`,
            runner: bind(createOpenRouterModelLLM(fbModel)),
            streaming: true,
          });
        }
      }
    }
  }

  return chain;
}

// Maximum number of llm->tools->llm cycles before the graph forces a final
// text answer (must match the guard in edges.js). When this limit is reached,
// we strip tools from the model so it is forced to reply with text instead of
// requesting yet another tool, guaranteeing the graph terminates.
const MAX_TOOL_LOOPS = Number(process.env.MAX_TOOL_LOOPS || 5);

export async function llmNode(state) {
  const { messages, enableSearch, queryType, intent, userContext, userId } = state;

  const isGeneralPath = queryType === QueryType.GENERAL_FITNESS;

  // When the tool-call loop is about to be capped, force the model to answer
  // with plain text by removing all tools. This prevents it from returning yet
  // another empty tool-call message (which would otherwise loop until the
  // graph's recursion limit is hit).
  const loopCount = Number(state.toolLoopCount) || 0;
  const forceText = !isGeneralPath && loopCount >= MAX_TOOL_LOOPS;
  if (forceText) {
    console.warn(
      `[Graph:llm] Tool loop limit (${loopCount}/${MAX_TOOL_LOOPS}) - forcing text-only response`
    );
  }

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

// On the general path we still build tools so the general-safe web_search tool
// is available (personal tools are excluded by policies). On forceText or when
// tools are disabled, bind no tools.
const tools = forceText ? [] : createGraphTools(excludedTools);
const hasImage = hasImageContent(messages);
const tokenSize = estimateTokens(messages);

  // ── Build the ordered fallback chain (highest quality → lowest). ──────
  const chain = buildRunnerChain({ isGeneralPath, hasImage, enableSearch, tools, tokenSize });

  console.log(
    `[Graph:llm] Invoking - ${tools.length} tools bound, ${messages.length} messages, ` +
      `chain=[${chain.map((c) => c.label).join(", ")}]`
  );

  let lastError = null;
  for (const candidate of chain) {
    let response;
    try {
      response = await candidate.runner.invoke(messages);
    } catch (invokeError) {
      lastError = invokeError;
      console.error(
        `[Graph:llm] Model "${candidate.label}" failed: ${invokeError?.message || invokeError}`
      );
      emitEvent(state, "ai.model.fallback", {
        userId,
        from: candidate.label,
        to: chain
          .slice(chain.indexOf(candidate) + 1)
          .map((c) => c.label)
          .join(",") || "none",
        reason: "error",
      });
      continue; // try next model in the chain
    }

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
  }

  // ── All models failed. Try the classifier fallback, else a safe reply. ─
  console.error(`[Graph:llm] All models failed. Last error: ${lastError?.message || lastError}`);
  const classifierFallback = intent?.classifierResponse?.trim();
  if (classifierFallback) {
    console.warn("[Graph:llm] Falling back to classifier response after all models failed");
    return { messages: [new AIMessage({ content: classifierFallback })] };
  }

  const safeFallback = new AIMessage({
    content:
      "I hit a temporary model issue. Please resend your message and I will answer right away.",
  });

  return { messages: [safeFallback] };
}
