// src/ai/graph/fitness/nodes/buildPromptNode.js

import { selectPrompt } from "../../../prompts/selectPrompt.js";
import { buildChatHistory, buildInitialMessages } from "../../../streaming/messageBuilder.js";
import {
  buildMultimodalContent,
  isMultimodalContent,
} from "../../../multimodal/contentBuilder.js";
import {
  injectRelevantProfileFields,
  shouldSkipHistory,
} from "../policies.js";
import { emitAiEvent } from "../../../../services/eventBus.js";
import { formatGoalForContext } from "../../../../services/goalService.js";

function buildGoalResponseInstruction(goalAction, activeGoal) {
  if (!goalAction?.kind) return "";

  if (goalAction.kind === "draft") {
    const questions = goalAction.draft?.questions || [];
    return [
      "=== GOAL WORKFLOW INSTRUCTION ===",
      "You are currently collecting missing details for a new goal.",
      "Do not give general fitness advice yet.",
      "Ask only for the missing details listed in the goal draft.",
      "Ask at most 2 concise questions total.",
      "If questions are already provided below, use them directly.",
      ...questions.map((question, index) => `${index + 1}. ${question}`),
    ].join("\n");
  }

  if (goalAction.kind === "created") {
    return [
      "=== GOAL WORKFLOW INSTRUCTION ===",
      "A goal was already created in the backend during this turn.",
      "Do not ask to create the goal again.",
      "Confirm the goal clearly, summarize the target briefly, and guide the user into the first next step.",
      "Keep the response action-oriented.",
      activeGoal ? `Goal title: ${activeGoal.title}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (goalAction.kind === "lookup") {
    return [
      "=== GOAL WORKFLOW INSTRUCTION ===",
      "The user is asking about their active goal.",
      "Summarize the goal status, current progress, and the next step.",
      "Do not answer in generic terms.",
    ].join("\n");
  }

  if (goalAction.kind === "progress_updated") {
    return [
      "=== GOAL WORKFLOW INSTRUCTION ===",
      "Progress was updated during this turn.",
      "Acknowledge the updated progress and recommend the next practical action.",
      "Keep the response specific to the active goal.",
    ].join("\n");
  }

  return "";
}

export async function buildPromptNode(state) {
  const {
    originalMessage,
    files,
    intent,
    userContext,
    conversationHistory,
    userId,
    profile,
  } = state;

  const contextWithProfile = injectRelevantProfileFields(userContext, profile);
  const promptUserContext = contextWithProfile ?? { profile: profile ?? null };

  if (contextWithProfile?.profile?._profileSummary) {
    const fields = ["fitnessGoal", "experience", "activityLevel"].filter(
      (f) => contextWithProfile.profile[f]
    );
    console.log(`[Graph:prompt] Profile injected - fields: ${fields.join(", ")}`);
  }

const { systemPrompt, promptTier } = selectPrompt({
    intent,
    userContext: promptUserContext,
    userId,
  });
  console.log(`[Graph:prompt] ${promptTier} prompt selected`);

  // Inject the user's active goal (if any) into the system prompt so the
  // assistant reasons in the context of the user's objective, plan, and
  // progress — the core of goal-based agent behavior.
  const goalContext = state.activeGoal
    ? formatGoalForContext(state.activeGoal)
    : promptUserContext?.goalContext || "";
  const goalInstruction = buildGoalResponseInstruction(state.goalAction, state.activeGoal);
  const finalSystemPrompt = [systemPrompt, goalContext, goalInstruction]
    .filter(Boolean)
    .join("\n\n");

  const chatHistory = buildChatHistory(conversationHistory);
  const filteredHistory = shouldSkipHistory(intent) ? [] : chatHistory;

  if (chatHistory.length > 0 && filteredHistory.length === 0) {
    console.log(
      `[Graph:prompt] Chat history SKIPPED for intent "${intent.intent}" ` +
        `(saved ~${chatHistory.length * 50} tokens)`
    );
  }

  let userContent;
  if (isMultimodalContent(files)) {
    console.log("[Graph:prompt] Building multimodal content (text + files)...");
    userContent = await buildMultimodalContent(originalMessage, files);
  } else {
    userContent = originalMessage;
  }

const messages = buildInitialMessages(finalSystemPrompt, filteredHistory, userContent);
  console.log(`[Graph:prompt] ${messages.length} messages assembled`);

  await emitAiEvent("ai.prompt.built", {
    userId,
    intent: intent?.intent || null,
    promptTier,
    messageCount: messages.length,
    historyCount: filteredHistory.length,
  });

  return { messages, userContext: contextWithProfile ?? promptUserContext };
}
