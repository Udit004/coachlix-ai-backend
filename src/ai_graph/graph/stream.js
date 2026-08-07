// src/ai/graph/stream.js
// LangGraph streaming runner for AI chat.

import { getCompiledGraph } from "./index.js";
import {
  extractChunkText,
  streamTextToFrontend,
  sendCompletionSignal,
} from "../streaming/streamProcessor.js";
import {
  getContentTypeDescription,
  getFilesSummary,
} from "../multimodal/contentBuilder.js";
import { getContextStats } from "../search/semanticMemoryRetrieval.js";
import { emitAiEvent } from "../../services/eventBus.js";

function projectProfileForClassification(profile) {
  if (!profile || typeof profile !== "object") return null;
  const username =
    typeof profile.username === "string" && profile.username.trim()
      ? profile.username.trim()
      : typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : null;

  const hasDietPlan =
    typeof profile.hasDietPlan === "boolean"
      ? profile.hasDietPlan
      : Boolean(profile.activeDietPlan || profile.activeDietPlanId);
  const hasWorkoutPlan =
    typeof profile.hasWorkoutPlan === "boolean"
      ? profile.hasWorkoutPlan
      : Boolean(profile.activeWorkoutPlan || profile.activeWorkoutPlanId);

  const projected = {
    username,
    fitnessGoal: profile.fitnessGoal ?? null,
    experience: profile.experience ?? null,
    activityLevel: profile.activityLevel ?? null,
    gender: profile.gender ?? null,
    age: Number.isFinite(profile.age) ? profile.age : null,
    hasDietPlan,
    hasWorkoutPlan,
  };

  return Object.fromEntries(
    Object.entries(projected).filter(([, value]) => value !== null && value !== undefined)
  );
}

const emitBoth = async (type, payload, onEvent) => {
  await emitAiEvent(type, payload);
  if (typeof onEvent === "function") {
    try {
      onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:event] onEvent callback failed for ${type}:`, error?.message || error);
    }
  }
};

export async function processChatWithGraph(params, onChunk, onEvent) {
  const {
    message,
    files = null,
    userId,
    plan = "general",
    profile = null,
    conversationHistory = [],
  } = params;

  const startTime = Date.now();
  const contentType = getContentTypeDescription(message, files);
  const filesSummary = getFilesSummary(files);
  const classificationProfile = projectProfileForClassification(profile);

  console.log("\n" + "=".repeat(80));
  console.log("[Graph] LANGGRAPH PIPELINE STARTING");
  console.log("[Graph] User:", userId);
  console.log("[Graph] Message:", message);
  console.log("[Graph] History:", conversationHistory.length, "messages");
  console.log("[Graph] Content type:", contentType);
  if (filesSummary.count > 0) {
    console.log("[Graph] Files:", filesSummary.count, "| Types:", filesSummary.types?.join(", "));
  }
  console.log("=".repeat(80) + "\n");

  const initialState = {
    messages: [],
    userId,
    originalMessage: message,
    files,
    conversationHistory,
    profile: classificationProfile,
    startTime,
    toolsUsed: [],
    flowMetrics: {},
    onEvent,
  };

  await emitBoth("ai.reasoning.started", {
    userId,
    plan,
    messagePreview: message.slice(0, 120),
    hasFiles: filesSummary.count > 0,
  }, onEvent);

  let fullResponse = "";
  let lastWord = "";
  let toolsUsed = [];
  let intentMeta = null;
  let contextStatsMeta = null;
  let enableSearchMeta = false;

  const graph = getCompiledGraph();

  try {
    const eventStream = graph.streamEvents(initialState, { version: "v2" });

    for await (const event of eventStream) {
      const { event: eventType, data, metadata } = event;

      if (eventType === "on_chat_model_stream" && metadata?.langgraph_node === "llm") {
        const chunk = data?.chunk;
        const text = extractChunkText(chunk);
        if (text) {
          await emitBoth("ai.model.token.streamed", {
            userId,
            plan,
            chunkLength: text.length,
            partialLength: fullResponse.length + text.length,
          }, onEvent);
          fullResponse += text;
          lastWord = await streamTextToFrontend(text, fullResponse, onChunk);
        }
        continue;
      }

      if (eventType !== "on_chain_end") {
        continue;
      }

      const output = data?.output;
      if (!output) continue;

      if (
        (metadata?.langgraph_node === "greeting" || metadata?.langgraph_node === "directGeneral") &&
        !fullResponse &&
        Array.isArray(output.messages) &&
        output.messages.length > 0
      ) {
        for (const msg of output.messages) {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
              ? msg.content.map((c) => (typeof c === "string" ? c : c.text ?? "")).join("")
              : "";

          if (text) {
            fullResponse += text;
            lastWord = await streamTextToFrontend(text, fullResponse, onChunk);
            console.log(
              `[Graph:stream] Greeting template streamed (${text.length} chars) - no LLM call`
            );
          }
        }
      }

      if (
        metadata?.langgraph_node === "llm" &&
        !fullResponse &&
        Array.isArray(output.messages) &&
        output.messages.length > 0
      ) {
        for (const msg of output.messages) {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
              ? msg.content.map((c) => (typeof c === "string" ? c : c.text ?? "")).join("")
              : "";

          if (text) {
            fullResponse += text;
            lastWord = await streamTextToFrontend(text, fullResponse, onChunk);
            console.log(
              `[Graph:stream] Non-streaming llm output emitted (${text.length} chars)`
            );
          }
        }
      }

      if (output.intent) intentMeta = output.intent;
      if (output.userContext) contextStatsMeta = getContextStats(output.userContext);
      if (typeof output.enableSearch === "boolean") enableSearchMeta = output.enableSearch;
      if (Array.isArray(output.toolsUsed) && output.toolsUsed.length > 0) {
        toolsUsed = [...toolsUsed, ...output.toolsUsed];
      }
    }

    await sendCompletionSignal(onChunk, fullResponse, lastWord || "done");

    await emitBoth("ai.reasoning.completed", {
      userId,
      plan,
      responseLength: fullResponse.length,
      toolsUsed,
    }, onEvent);

    const totalTime = Date.now() - startTime;

    console.log("\n" + "=".repeat(80));
    console.log("[Graph] PIPELINE COMPLETE");
    console.log("[Graph] Total time:", totalTime, "ms");
    console.log("[Graph] Response length:", fullResponse.length, "chars");
    console.log("[Graph] Tools used:", toolsUsed.join(", ") || "none");
    console.log("[Graph] Google Search:", enableSearchMeta ? "yes" : "no");
    console.log("=".repeat(80) + "\n");

    return {
      response: fullResponse,
      metadata: {
        architecture: "langgraph",
        graphVersion: "0.3",

        contentType,
        hasFiles: filesSummary.count > 0,
        filesProcessed: filesSummary.count,
        filesSummary: filesSummary.count > 0 ? filesSummary : null,

        intent: intentMeta?.intent ?? null,
        intentConfidence: intentMeta?.confidence ?? null,
        requiresData: intentMeta?.requiresData ?? false,
        priority: intentMeta?.dataNeeds?.priority ?? null,
        intentClassifierVersion: intentMeta?.version ?? "v2",
        hasMultipleIntents: intentMeta?.hasMultipleIntents ?? false,
        disambiguationApplied: intentMeta?.disambiguationApplied ?? false,
        entitiesExtracted: intentMeta?.entityStats?.totalEntities ?? 0,
        entities: intentMeta?.entities ?? null,

        contextStats: contextStatsMeta,

        googleSearchEnabled: enableSearchMeta,
        searchReason: enableSearchMeta ? `Intent: ${intentMeta?.intent}` : "Not needed",

        reasoningEnabled: false,
        reasoningPath: "none",
        reactEnabled: false,
        reactSteps: 0,
        reactToolCalls: 0,
        keyPoints: [],

        llmCalls:
          intentMeta?.intent === "greeting" ? 0 : toolsUsed.length > 0 ? toolsUsed.length + 1 : 1,
        toolsUsed,
        toolCallCount: toolsUsed.length,

        validationEnabled: false,
        validationScore: null,
        validationVerdict: null,
        autoFixApplied: false,

        timings: { totalTime },
        timeTaken: totalTime,
        responseLength: fullResponse.length,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("[Graph] Pipeline error:", error);

    await emitBoth("ai.tool.failed", {
      userId,
      plan,
      error: error.message,
    }, onEvent);

    try {
      await sendCompletionSignal(onChunk, fullResponse, lastWord || "error");
    } catch (_) {
      // Ignore callback failures to avoid masking root cause.
    }

    const timeTaken = Date.now() - startTime;
    return {
      response:
        "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
      metadata: {
        architecture: "langgraph",
        error: error.message,
        llmCalls: 0,
        timings: { totalTime: timeTaken },
        timeTaken,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

export const processAiChat = processChatWithGraph;
