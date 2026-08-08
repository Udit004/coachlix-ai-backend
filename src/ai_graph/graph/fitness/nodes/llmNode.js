// src/ai/graph/fitness/nodes/llmNode.js

import { AIMessage } from "@langchain/core/messages";
import { QueryType } from "../../../reasoning/intentRouter.js";
import {
  createStreamingLLM,
  createGroqLLM,
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
function buildRunnerChain({ isGeneralPath, hasImage, enableSearch, tools }) {
  const chain = [];

  // ── Images/files MUST use a multimodal model (Gemini). ─────────────────
  // Gemini does NOT support the complex JSON-Schema `$ref` produced by the
  // nested DynamicStructuredTool schemas, so we NEVER bind tools to it.
  // Image requests don't need tool-calling anyway.
  if (hasImage) {
    chain.push({
      label: "gemini-2.5-flash",
      runner: createStreamingLLM(true),
      streaming: true,
    });
    return chain;
  }

  // ── Text paths: always Groq (70B primary, 8B fallback). ────────────────
  // Gemini is reserved exclusively for images/files. Binding the complex tool
  // schemas to Gemini throws a 400 `$ref` error, and Groq is the preferred
  // text model anyway.
  const bind = (llm) => (tools.length > 0 ? llm.bindTools(tools) : llm);

  if (isGeneralPath) {
    // General text: no tools needed.
    chain.push({
      label: "groq-70b",
      runner: createGroqLLM(true, {
        model: process.env.GROQ_GENERAL_MODEL?.trim() || "llama-3.3-70b-versatile",
        temperature: 0.2,
        maxRetries: 0,
      }),
      streaming: true,
    });
    chain.push({
      label: "groq-8b",
      runner: createGroqLLM(true, {
        model: process.env.GROQ_SMALL_MODEL?.trim() || "llama-3.1-8b-instant",
        temperature: 0.2,
        maxRetries: 0,
      }),
      streaming: true,
    });
    return chain;
  }

// ── Personalized / tool path. Fallback chain order (as requested): ─────
  //   1. Groq 70B (primary for complex text reasoning/tool-calling)
  //   2. OpenRouter powerful FREE model (Nemotron 3 Super 120B)
  //   3. Gemini 2.5 Flash (last resort for text; REQUIRED for images/files)
  // The user explicitly wants Groq 70B for text and Gemini ONLY for
  // files/images. Tools are SPLIT into flat single-purpose schemas (no nested
  // `$ref`) so they are compatible across providers. If a candidate fails
  // (rate-limit, schema `$ref` error, network, quota), the caller
  // automatically tries the next model in the chain.
  const hasOpenRouterKey = Boolean(OPENROUTER_CONFIG.apiKey);

  // 1. Groq 70B primary for text reasoning/tool-calling.
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

  // 2. OpenRouter powerful free model (if API key configured).
  if (hasOpenRouterKey) {
    chain.push({
      label: "openrouter",
      runner: bind(createOpenRouterLLM(true)),
      streaming: true,
    });
    // Additional OpenRouter fallback models (skip the primary, already tried).
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

// 3. Gemini 2.5 Flash (last resort for text; REQUIRED for images/files).
  chain.push({
    label: "gemini-2.5-flash",
    runner: bind(createStreamingLLM(true)),
    streaming: true,
  });

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

const tools = isGeneralPath || forceText ? [] : createGraphTools(excludedTools);
  const hasImage = hasImageContent(messages);

  // ── Build the ordered fallback chain (highest quality → lowest). ──────
  const chain = buildRunnerChain({ isGeneralPath, hasImage, enableSearch, tools });

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
