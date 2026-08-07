// src/ai/graph/fitness/nodes/intentNode.js

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { QueryType } from "../../../reasoning/intentRouter.js";
import { createStreamingLLM } from "../../../config/llmconfig.js";
import { LLM_CONFIG } from "../../../config/llmconfig.js";
import {
  shouldEnableSearch,
  logSearchUsage,
} from "../../../config/searchGrounding.js";

const INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are an AI fitness assistant. You classify the user's latest message into an intent. The user may write in ANY language (e.g. Hindi, Hinglish, Spanish, Tamil, French) and in ANY wording — classify by MEANING, never by keyword lists or literal phrasing.

You will be given a conversation history followed by the user's latest message.

Step 1: Classify the latest message into exactly one of:
- GREETING
- GENERAL_QUERY
- PERSONALIZED_QUERY
- OFF_TOPIC

Step 2:
- If GREETING -> respond naturally
- If GENERAL_QUERY -> answer normally
- If PERSONALIZED_QUERY -> DO NOT answer, instead mark needs_rag = true
- If OFF_TOPIC -> mark intent = OFF_TOPIC and provide a polite refusal in 'response'

---

RULES:
- MEMORY RECALL (IMPORTANT): If the latest message asks about a PAST or RECENT conversation — e.g. "what were we talking about", "what did we discuss recently", "what we are discussing recently", "remind me what we talked about last time", "what have we done so far", "recall our last chat", "what is the last thing we discussed" — classify it as PERSONALIZED_QUERY with needs_rag = true. Answering it REQUIRES loading conversation history and long-term memory, so the general path MUST NOT be used. This applies even if the message is phrased casually or in another language.
- COACHING / SKILL-LEARNING (IMPORTANT): If the user asks you to guide, coach, teach, or walk them through an exercise, movement, or skill (e.g. "guide me through the pull up", "teach me how to deadlift", "show me how to do a proper squat", "how do I do a push-up", "I want to learn pull-ups", "my goal is to master the bench press"), classify it as PERSONALIZED_QUERY with needs_rag = true. Tailored coaching REQUIRES the user's profile, experience level, fitness goal, and history, so the general path MUST NOT be used.
- The latest message may reference something from the conversation history (e.g. "that plan", "my routine", "continue", "about that"). Use the provided history to decide: if it continues a personalized action, mark PERSONALIZED_QUERY.
- If the latest message is a short reply/continuation ("yes", "sure", "ok", "go ahead", "no", "that's fine", "start", "let's begin", etc.) that answers the assistant's previous question, DO NOT treat it as a GREETING. Classify it as PERSONALIZED_QUERY (needs_rag = true) if it agrees to personalized actions (plans, metrics, coaching), or GENERAL_QUERY if it is a simple confirmation.
- If unsure -> GENERAL_QUERY
- OFF_TOPIC includes anything NOT related to fitness, health, nutrition, workout, or the Coachlix platform. Examples: coding, python, history, politics, general math (unless fitness related), etc.
- Do NOT hallucinate user data
- Keep responses concise and helpful

---

OUTPUT FORMAT (STRICT JSON):

{
  "intent": "...",
  "confidence": 0-1,
  "needs_rag": true/false,
  "response": "string (empty if needs_rag = true)"
}`;

const FALLBACK_RESULT = {
  intent: "GENERAL_QUERY",
  confidence: 0.51,
  needs_rag: false,
  response: "",
};

const QUICK_GREETING_PATTERN =
  /^(hi|hello|hey|hii+|heyy+|yo|sup|hola|namaste|good\s+(morning|afternoon|evening|night))[\s!.?]*$/i;
const CLASSIFIER_TIMEOUT_MS = Number(process.env.INTENT_CLASSIFIER_TIMEOUT_MS || 3500);

const PLAN_REFERENCE_PATTERN =
  /\b(my|current)\s+(diet|meal|workout|training|fitness)\s+plan\b/i;
const PERSONAL_CHECK_PATTERN =
  /\b(check|show|see|does|do|is|what(?:'s| is)|tell)\b/i;
const PERSONAL_PRONOUN_PATTERN = /\b(my|for me|mine)\b/i;
const SIMPLE_GENERAL_LEAD_PATTERN =
  /^(what is|what's|what are|who is|who are|define|meaning of|benefits of|benefit of|how much|how many|is|are)\b/i;
const SIMPLE_GENERAL_TOPIC_PATTERN =
  /\b(protein|calorie|calories|bmi|hydration|water|steps|sleep|soreness|muscle|fat|carb|carbs|exercise|workout)\b/i;
const COMPLEX_GENERAL_PATTERN =
  /\b(compare|comparison|difference|versus|vs\.?|better than|best for me|recommend|suggest|custom|personaliz|plan|routine|program|schedule|design|build|create|optimize|should i|can i|how should i|what should i|for my|my plan|my workout|my diet)\b/i;

function extractJsonBlock(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return trimmed.slice(first, last + 1);
}

function parseClassifierOutput(raw) {
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) {
    return FALLBACK_RESULT;
  }

  try {
    const parsed = JSON.parse(jsonText);
    const normalizedIntent = String(parsed.intent || "").trim().toUpperCase();
    const intent =
      normalizedIntent === "GREETING" ||
      normalizedIntent === "GENERAL_QUERY" ||
      normalizedIntent === "PERSONALIZED_QUERY" ||
      normalizedIntent === "OFF_TOPIC"
        ? normalizedIntent
        : "GENERAL_QUERY";

    const confidence = Number(parsed.confidence);
    const safeConfidence = Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0.51;

    const needsRag = Boolean(parsed.needs_rag);
    const response = typeof parsed.response === "string" ? parsed.response.trim() : "";

    return {
      intent,
      confidence: safeConfidence,
      needs_rag: intent === "PERSONALIZED_QUERY" ? true : needsRag,
      response,
    };
  } catch {
    return FALLBACK_RESULT;
  }
}

function buildDataNeeds(intentName, originalMessage, directAnswerable = false) {
  const lower = (originalMessage || "").toLowerCase();
  const needsDiet = /\b(diet|meal|food|nutrition|calorie|protein|carb|fat)\b/i.test(lower);
  const needsWorkout = /\b(workout|exercise|training|gym|strength|cardio|routine)\b/i.test(
    lower
  );

  if (intentName === "greeting" || intentName === "off_topic") {
    return {
      needsProfile: false,
      needsDiet: false,
      needsWorkout: false,
      needsHistory: false,
      needsVectorSearch: false,
      priority: "low",
    };
  }

  if (intentName === "question_general") {
    return {
      needsProfile: false,
      needsDiet: false,
      needsWorkout: false,
      needsHistory: false,
      needsVectorSearch: !directAnswerable,
      priority: "low",
    };
  }

  return {
    needsProfile: true,
    needsDiet,
    needsWorkout,
    needsHistory: true,
    needsVectorSearch: true,
    priority: "high",
  };
}

function formatHistoryForClassifier(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return "";
  }

  // Take the last 6 turns (3 user + 3 ai) to give the classifier enough
  // context to resolve memory-recall queries ("what we discussed recently")
  // and short follow-up replies like "yes" / "sure". Each message is capped
  // to keep tokens low.
  const recent = conversationHistory.slice(-6);
  return recent
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      const content = String(msg.content || "").slice(0, 300);
      return `${role}: ${content}`;
    })
    .join("\n");
}

async function classifyWithSmallLlm(originalMessage, conversationHistory = []) {
  const classifierLlm = createStreamingLLM(false, {
    model:
      process.env.INTENT_CLASSIFIER_MODEL?.trim() ||
      process.env.GENERAL_QUERY_MODEL?.trim() ||
      "gemini-2.5-flash-lite",
    temperature: 0,
    maxOutputTokens: 200,
    topP: 0.1,
    topK: 1,
    maxRetries: 0,
  });

  const historyText = formatHistoryForClassifier(conversationHistory);
  const userInput = historyText
    ? `CONVERSATION HISTORY:\n${historyText}\n\nLATEST USER MESSAGE:\n${originalMessage || ""}`
    : originalMessage || "";

  const output = await classifierLlm.invoke([
    new SystemMessage(INTENT_CLASSIFIER_SYSTEM_PROMPT),
    new HumanMessage(userInput),
  ]);

  const rawText =
    typeof output?.content === "string"
      ? output.content
      : JSON.stringify(output?.content ?? "");

  return parseClassifierOutput(rawText);
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Intent classifier timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function shouldForcePersonalizedQuery(message) {
  const text = (message || "").trim();
  if (!text) return false;

  // Queries about the user's own current plan must use RAG/tools.
  if (PLAN_REFERENCE_PATTERN.test(text)) {
    return true;
  }

  const asksForCheck = PERSONAL_CHECK_PATTERN.test(text);
  const hasPersonalOwnership = PERSONAL_PRONOUN_PATTERN.test(text);
  const mentionsPlan = /\b(plan|diet|workout|meal|schedule)\b/i.test(text);

  return asksForCheck && hasPersonalOwnership && mentionsPlan;
}

function shouldDirectAnswerGeneralQuery(message) {
  const text = (message || "").trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  if (wordCount > 14) return false;

  return (
    SIMPLE_GENERAL_LEAD_PATTERN.test(text) &&
    SIMPLE_GENERAL_TOPIC_PATTERN.test(text) &&
    !COMPLEX_GENERAL_PATTERN.test(text)
  );
}

const emitEvent = (state, type, payload) => {
  if (typeof state?.onEvent === "function") {
    try {
      state.onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:intent] onEvent failed for ${type}:`, error?.message || error);
    }
  }
};

// Queries that ask the assistant to recall past conversation / memory. These
// MUST go through the personalized path so long-term memory and history are
// loaded and injected; otherwise the LLM truthfully says "I have no memory".
// The alternatives are intentionally broad to tolerate word order variations:
//   - explicit "recall"/"remember"
//   - question verb + subject + past-action (what have we done / what did we
//     discuss / what we have talked about / tell me what we worked on)
//   - temporal marker + memory noun (recent/previous/past ... conversation)
const RECALL_QUERY_PATTERN =
  /\b(recall|remember)\b|\b(what|tell|show|summarize)\b.*\b(we|you|our)\b.*\b(done|do|doing|discuss(?:ed|ing)?|talk(?:ed|ing)?|chat(?:ted|ting)?|work(?:ed|ing)?|cover(?:ed|ing)?|been|said|spoke|speaking|talking|going|having|had)\b|\b(recent|previous|past|earlier|before|lately|last)\b.*\b(conversation|chat|memory|discussion|talk|history|time|session|topic|thing|things)\b/i;

// Short affirmation / follow-up replies that usually continue a prior
// assistant offer (e.g. "Would you like me to build your plan?" -> "yes").
const AFFIRMATION_PATTERN =
  /^(yes|yeah|yep|yup|sure|ok|okay|okayy?|alright|fine|go\s*ahead|please\s*(do|go)|let'?s\s*(do|go|start|begin)|do\s*it|start|begin|absolutely|definitely|sounds\s*good|that'?s?\s*(good|fine|great)|correct|right|hmm\s*yes)[\s!.?]*$/i;
const DECLINE_PATTERN =
  /^(no|nope|nah|not\s*now|no\s*thanks|not\s*really|maybe\s*later|skip|later)[\s!.?]*$/i;
const GOAL_REQUEST_PATTERN =
  /\b(create|build|make|start|set up|design|prepare|give me|help me create)\b.*\b(diet|meal|nutrition|workout|training|fitness|goal|plan|routine|schedule)\b|\b(i want to|i need to|my goal is|i am trying to|my aim is|i\'?d like to)\b.*\b(lose weight|gain muscle|build muscle|eat better|get fit|improve fitness|learn|master|get better|start|begin)\b/i;

// Coaching / skill-learning requests that MUST reach the goal-aware
// (personalized) path: the assistant needs the user's profile, experience
// level, fitness goal, and long-term memory to tailor the coaching. Examples:
//   - "guide me through the pull up exercise"
//   - "teach me how to do a proper deadlift"
//   - "my goal is to learn this exercise"
//   - "how do I do a handstand push-up for a beginner"
// These bypass the LLM classifier (cheap regex) and go straight to
// retrieveContext -> goalNode -> turn plan.
const COACHING_REQUEST_PATTERN =
  /\b(guide|coach|teach|train|help)\s+me\b|\b(show|tell)\s+me\s+how\b|\bhow\s+do\s+i\b|\bhow\s+to\s+(do|perform|improve|master|learn)\b|\b(learn|master|practice|improve|perfect)\s+(the|this|my)?\s*(exercise|movement|skill|form|technique|pull.?up|push.?up|squat|deadlift|bench|lunge|plank|dip|row|curl)\b|\bmy\s+goal\s+is\s+to\s+(learn|master|improve|get\s+better\s+at|perfect)\b/i;
const GOAL_FOLLOW_UP_TOPIC_PATTERN =
  /\b(vegetarian|vegan|non[\s-]?vegetarian|jain|home|gym|days? a week|kg|kgs|lb|lbs|pounds|lose|gain|weight|target)\b/i;

function containsFollowUpTopic(message) {
  const text = (message || "").toLowerCase();
  return /\b(health|bmi|metric|metric(s)?|diet|meal|food|workout|exercise|plan|target|calorie|protein|fat|weight|train|goal)\b/i.test(
    text
  ) || /\b(yes|yeah|sure|ok|okay|go ahead|let'?s|start|begin|do it)\b/i.test(text);
}

function isGoalFollowUp(message, conversationHistory = []) {
  const text = (message || "").trim();
  if (!text || text.length > 120 || !GOAL_FOLLOW_UP_TOPIC_PATTERN.test(text)) {
    return false;
  }

  const lastAssistant = [...conversationHistory]
    .reverse()
    .find((m) => m.role === "ai" || m.role === "assistant");
  const lastAssistantText = String(lastAssistant?.content || "").toLowerCase();

  const wasAskingGoalQuestion =
    /\?/.test(lastAssistantText) &&
    /\b(goal|diet|meal|nutrition|workout|training|plan|weight|target|preference|days|gym|home)\b/i.test(
      lastAssistantText
    );

  return wasAskingGoalQuestion;
}

export async function intentNode(state) {
  const { originalMessage, userId, conversationHistory = [] } = state;
  const t0 = Date.now();

  // Fast-path affirmation: if the user gives a short confirmation/continuation
  // and there is preceding assistant context offering a personalized action,
  // route it to the personalized path WITHOUT an LLM classifier call.
  const hasHistory = Array.isArray(conversationHistory) && conversationHistory.length > 0;
  const trimmed = (originalMessage || "").trim();

  if (hasHistory && AFFIRMATION_PATTERN.test(trimmed)) {
    const lastAssistant = [...conversationHistory]
      .reverse()
      .find((m) => m.role === "ai" || m.role === "assistant");
    const lastAssistantText = String(lastAssistant?.content || "").toLowerCase();

    const offersPersonalizedAction =
      /\b(calculate|build|create|start|set up|make|generate|proceed with|lets?|let'?s)\b/i.test(
        lastAssistantText
      ) &&
      /\b(health|bmi|metric|diet|meal|plan|workout|exercise|target|calorie|protein|goal|coach)\b/i.test(
        lastAssistantText
      );

    if (offersPersonalizedAction || containsFollowUpTopic(originalMessage)) {
      const result = {
        intent: "question_specific",
        confidence: 0.9,
        requiresData: true,
        dataNeeds: {
          needsProfile: true,
          needsDiet: true,
          needsWorkout: true,
          needsHistory: true,
          needsVectorSearch: true,
          priority: "high",
        },
        classifierIntent: "PERSONALIZED_QUERY",
        classifierResponse: "",
        version: "llm-small-v1-affirmation-fastpath",
      };

      console.log(
        "[Graph:intent] Affirmation fast-path -> question_specific (continuing prior assistant offer)"
      );

      emitEvent(state, "ai.intent.classified", {
        userId,
        intent: "question_specific",
        confidence: 0.9,
        requiresData: true,
        classifierIntent: "PERSONALIZED_QUERY",
        fastPath: true,
        followUp: true,
      });

      return {
        intent: result,
        queryType: QueryType.PERSONALIZED_FITNESS,
        needsRag: true,
        greetingResponse: "",
        enableSearch: false,
        flowMetrics: { intentClassificationTime: Date.now() - t0 },
      };
    }
  }

// Fast-path coaching / skill-learning: coaching the user on an exercise,
  // form, or skill requires their profile, experience level, and long-term
  // memory to tailor the guidance. Route straight to the personalized path
  // (retrieveContext -> goalNode -> turn plan) — no LLM classifier call.
  if (COACHING_REQUEST_PATTERN.test(trimmed)) {
    const result = {
      intent: "question_specific",
      confidence: 0.95,
      requiresData: true,
      dataNeeds: {
        needsProfile: true,
        needsDiet: /\b(diet|meal|nutrition|food)\b/i.test(trimmed),
        needsWorkout: true,
        needsHistory: true,
        needsVectorSearch: true,
        priority: "high",
      },
      classifierIntent: "PERSONALIZED_QUERY",
      classifierResponse: "",
      version: "llm-small-v1-coaching-fastpath",
    };

    console.log(
      "[Graph:intent] Coaching fast-path -> question_specific (exercise/skill-learning requires profile + goal context)"
    );

    emitEvent(state, "ai.intent.classified", {
      userId,
      intent: "question_specific",
      confidence: 0.95,
      requiresData: true,
      classifierIntent: "PERSONALIZED_QUERY",
      fastPath: true,
      coachingRequest: true,
    });

    return {
      intent: result,
      queryType: QueryType.PERSONALIZED_FITNESS,
      needsRag: true,
      greetingResponse: "",
      enableSearch: false,
      flowMetrics: { intentClassificationTime: Date.now() - t0 },
    };
  }

  if (GOAL_REQUEST_PATTERN.test(trimmed) || isGoalFollowUp(trimmed, conversationHistory)) {
    const result = {
      intent: "question_specific",
      confidence: 0.93,
      requiresData: true,
      dataNeeds: {
        needsProfile: true,
        needsDiet: /\b(diet|meal|nutrition)\b/i.test(trimmed),
        needsWorkout: /\b(workout|training|gym|routine)\b/i.test(trimmed),
        needsHistory: true,
        needsVectorSearch: true,
        priority: "high",
      },
      classifierIntent: "PERSONALIZED_QUERY",
      classifierResponse: "",
      version: "llm-small-v1-goal-fastpath",
    };

    emitEvent(state, "ai.intent.classified", {
      userId,
      intent: "question_specific",
      confidence: result.confidence,
      requiresData: true,
      classifierIntent: "PERSONALIZED_QUERY",
      fastPath: true,
      goalRequest: true,
    });

    return {
      intent: result,
      queryType: QueryType.PERSONALIZED_FITNESS,
      needsRag: true,
      greetingResponse: "",
      enableSearch: false,
      flowMetrics: { intentClassificationTime: Date.now() - t0 },
    };
  }

// Fast-path memory recall: when the user asks the assistant to recall past
  // conversation/memory, ALWAYS route to the personalized path so long-term
  // memory and history get loaded and injected. Bypasses the LLM classifier
  // (saves a call) and avoids the general path that strips memory.
  if (RECALL_QUERY_PATTERN.test(trimmed)) {
    const recallResult = {
      intent: "question_specific",
      confidence: 0.92,
      requiresData: true,
      dataNeeds: {
        needsProfile: true,
        needsDiet: false,
        needsWorkout: false,
        needsHistory: true,
        needsVectorSearch: true,
        priority: "high",
      },
      classifierIntent: "PERSONALIZED_QUERY",
      classifierResponse: "",
      version: "llm-small-v1-recall-fastpath",
    };

    console.log(
      "[Graph:intent] Recall fast-path -> question_specific (loading long-term memory + history)"
    );

    emitEvent(state, "ai.intent.classified", {
      userId,
      intent: "question_specific",
      confidence: 0.92,
      requiresData: true,
      classifierIntent: "PERSONALIZED_QUERY",
      fastPath: true,
      memoryRecall: true,
    });

    return {
      intent: recallResult,
      queryType: QueryType.PERSONALIZED_FITNESS,
      needsRag: true,
      greetingResponse: "",
      enableSearch: false,
      flowMetrics: { intentClassificationTime: Date.now() - t0 },
    };
  }

  // Ensure a bare greeting is NOT fast-pathed when it's actually a follow-up
  // confirmation (e.g. user starts with "hi" then continues; only treat as
  // greeting when there is no meaningful prior context).
  if (QUICK_GREETING_PATTERN.test(trimmed) && !hasHistory) {
    const quickResult = {
      intent: "greeting",
      confidence: 0.99,
      requiresData: false,
      dataNeeds: buildDataNeeds("greeting", originalMessage),
      classifierIntent: "GREETING",
      classifierResponse: "",
      version: "llm-small-v1-fastpath",
    };

    console.log("[Graph:intent] Fast-path greeting detected");

    emitEvent(state, "ai.intent.classified", {
      userId,
      intent: "greeting",
      confidence: 0.99,
      requiresData: false,
      classifierIntent: "GREETING",
      fastPath: true,
    });

    return {
      intent: quickResult,
      queryType: QueryType.GREETING,
      needsRag: false,
      greetingResponse: "",
      enableSearch: false,
      flowMetrics: { intentClassificationTime: Date.now() - t0 },
    };
  }

let classifierResult;

  try {
    classifierResult = await withTimeout(
      classifyWithSmallLlm(originalMessage, conversationHistory),
      CLASSIFIER_TIMEOUT_MS
    );
  } catch (error) {
    console.warn(
      `[Graph:intent] Small-LLM classifier failed, falling back to GENERAL_QUERY: ${error.message}`
    );
    classifierResult = FALLBACK_RESULT;
  }

  // Post-LLM safety overrides:
  //  1. Personalized plans/metrics phrasing ("show my plan") -> personalized.
  //  2. Memory-recall phrasing ("what did we discuss recently") -> personalized
  //     so history + long-term memory are loaded. The LLM classifier should
  //     catch these, but this regex is a safety net for any missed phrasing.
  //  3. Coaching / skill-learning phrasing -> personalized (needs profile +
  //     experience + goal context to tailor guidance).
  const forcedPersonalized =
    shouldForcePersonalizedQuery(originalMessage) ||
    RECALL_QUERY_PATTERN.test(trimmed) ||
    COACHING_REQUEST_PATTERN.test(trimmed);
  if (forcedPersonalized && classifierResult.intent !== "PERSONALIZED_QUERY") {
    classifierResult = {
      ...classifierResult,
      intent: "PERSONALIZED_QUERY",
      needs_rag: true,
      response: "",
      confidence: Math.max(classifierResult.confidence, 0.75),
    };
  }

  const intentName =
    classifierResult.intent === "GREETING"
      ? "greeting"
      : classifierResult.intent === "PERSONALIZED_QUERY"
        ? "question_specific"
        : classifierResult.intent === "OFF_TOPIC"
          ? "off_topic"
          : "question_general";

  const queryType =
    classifierResult.intent === "GREETING"
      ? QueryType.GREETING
      : classifierResult.intent === "PERSONALIZED_QUERY"
        ? QueryType.PERSONALIZED_FITNESS
        : classifierResult.intent === "OFF_TOPIC"
          ? QueryType.OFF_TOPIC
          : QueryType.GENERAL_FITNESS;

  const intent = {
    intent: intentName,
    confidence: classifierResult.confidence,
    requiresData: classifierResult.needs_rag,
    directAnswerable:
      intentName === "question_general" &&
      !classifierResult.needs_rag &&
      Boolean(classifierResult.response) &&
      shouldDirectAnswerGeneralQuery(originalMessage),
    dataNeeds: buildDataNeeds(
      intentName,
      originalMessage,
      intentName === "question_general" &&
        !classifierResult.needs_rag &&
        Boolean(classifierResult.response) &&
        shouldDirectAnswerGeneralQuery(originalMessage)
    ),
    classifierIntent: classifierResult.intent,
    classifierResponse: classifierResult.response,
    version: "llm-small-v1",
  };

  const enableSearch = shouldEnableSearch(intent, originalMessage);
  logSearchUsage(state.userId, intent, enableSearch);

  emitEvent(state, "ai.intent.classified", {
    userId,
    intent: intent.intent,
    confidence: intent.confidence,
    requiresData: intent.requiresData,
    classifierIntent: intent.classifierIntent,
    queryType: String(queryType),
    enableSearch,
    forcedPersonalized,
    priority: intent.dataNeeds?.priority,
  });

  console.log(
    `[Graph:intent] ${classifierResult.intent}=>${intent.intent} ` +
      `(${(intent.confidence * 100).toFixed(0)}%) ` +
      `queryType=${queryType} ` +
      `needsRag=${classifierResult.needs_rag} ` +
      `directAnswerable=${intent.directAnswerable} ` +
      `forcedPersonalized=${forcedPersonalized} ` +
      `priority=${intent.dataNeeds?.priority} ` +
      `search=${enableSearch}`
  );

  return {
    intent,
    queryType,
    needsRag: classifierResult.needs_rag,
    greetingResponse:
      classifierResult.intent === "GREETING" || classifierResult.intent === "OFF_TOPIC"
        ? classifierResult.response
        : "",
    enableSearch,
    flowMetrics: { intentClassificationTime: Date.now() - t0 },
  };
}
