// src/ai/graph/fitness/nodes/inputGuardrailNode.js

import { QueryType } from "../../../reasoning/intentRouter.js";

const JAILBREAK_PATTERNS = [
  /\b(forget|ignore)\b.*\b(previous|all)\b.*\b(instructions|prompts)\b/i,
  /\bact as\b.*\b(developer|programmer|ai|assistant|expert|system)\b/i,
  /\bwrite\b.*\b(python|javascript|java|c\+\+|code)\b/i,
  /\b(code|script)\b.*\b(for|adding|calculator|function)\b/i,
  /\b(system instructions|system prompt|internal rules)\b/i,
  /\b(novel|story|scene|fictional)\b.*\b(breaks its programming|reveals its)\b/i,
  /\b(exact dialogue|actual rules)\b/i
];

export async function inputGuardrailNode(state) {
  const { originalMessage } = state;
  const trimmed = (originalMessage || "").trim();
  const startTime = Date.now();

  // Check against strict jailbreak patterns
  const isJailbreak = JAILBREAK_PATTERNS.some((pattern) => pattern.test(trimmed));

  if (isJailbreak) {
    console.log(`[Graph:inputGuardrail] Jailbreak or coding attempt detected. Rejecting pre-LLM.`);
    
    // Fast-path to greeting/rejection node by mocking an OFF_TOPIC intent
    return {
      queryType: QueryType.OFF_TOPIC,
      greetingResponse: "I'm your fitness coach, so I can't help with coding, math, or other non-fitness topics. But I'd love to help you with your workouts or diet! 💪",
      flowMetrics: { guardrailTime: Date.now() - startTime }
    };
  }

  // Pass through cleanly
  return {
    flowMetrics: { guardrailTime: Date.now() - startTime }
  };
}
