// src/services/summarizeWorker.js
// Event-driven session summarizer. Consumes turn/completion events and, when
// the session crosses the message threshold, generates a compact summary via
// Gemini, persists it to MongoDB, and indexes it into Pinecone for semantic
// recall. Runs off the hot request path.
//
// To avoid exhausting the Gemini rate limit, the summarizer is throttled:
//   - trivial / error-only / short conversations are skipped
//   - a per-session cooldown prevents summarising the same chat too often
//   - a global per-minute budget caps how many LLM summarizations can run

import ConversationSummary from '../models/ConversationSummary.js';
import ChatSession from '../models/ChatSession.js';
import { connectMongo } from '../db/mongo.js';
import { env } from '../config/env.js';
import { getEventBus } from './eventBus.js';
import { indexMemory } from './longTermMemoryService.js';
import {
  canSpendMemoryLlmBudget,
  canSpendMemoryLlmBudgetForUser,
  acquireTurnLock,
  markMemoryRun,
  isWithinCooldown,
  isMemoryWorthy,
} from './memoryThrottle.js';

const SUMMARY_SYSTEM_PROMPT = `You are a memory summarizer for Coachlix, an AI fitness coach.
Given a conversation transcript, produce a concise summary in plain text (no markdown) that captures:
- The user's fitness/diet/workout goals and any progress
- Stable preferences (food, training style, schedule, equipment)
- Constraints or injuries
- Actionable items or decisions made
- Notable facts worth remembering across sessions

Keep the summary under 220 words. Also output 3-6 short key facts, one per line,
each starting with "- ". Do not include names unless necessary.`;

function buildTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => `${m.role === 'user' ? 'User' : 'Coachlix'}: ${String(m.content || '').slice(0, 400)}`)
    .join('\n');
}

function parseSummary(raw) {
  const text = String(raw || '').trim();
  const keyFacts = [];
  const summaryLines = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^-\s+/.test(trimmed)) {
      keyFacts.push(trimmed.replace(/^-\s+/, '').trim());
    } else if (trimmed) {
      summaryLines.push(trimmed);
    }
  }

  return {
    summary: summaryLines.join(' ').slice(0, 2000) || text.slice(0, 2000),
    keyFacts,
  };
}

/**
 * Summarize a chat session and persist + vector-index the result.
 * Idempotent via a dedup key derived from (userId, sessionId, windowEnd).
 */
export async function summarizeSession(session) {
  if (!session?._id) return null;

  const userId = session.userId;
  const sessionId = String(session._id);
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const messageCount = messages.length;

  if (messageCount < (env.memorySummaryThreshold || 8)) {
    return null;
  }

  // Skip trivial / error-only conversations so we don't waste LLM calls.
  if (!isMemoryWorthy(messages, {})) {
    return null;
  }

  // Respect per-session cooldown so we don't summarise on every turn.
  if (await isWithinCooldown('summary', sessionId)) {
    return null;
  }

  // Enforce a global per-minute budget for memory LLM calls.
  if (!(await canSpendMemoryLlmBudget())) {
    return null;
  }

  const transcript = buildTranscript(messages);
  if (!transcript.trim()) return null;

  const windowEnd = session.updatedAt || new Date();
  const dedupKey = `${userId}:${sessionId}:${windowEnd.getTime?.() || Date.now()}`;

  const existing = await ConversationSummary.findOne({ dedupKey });
  if (existing) return existing;

  let summaryText = '';
  let keyFacts = [];
  let topics = [];

  try {
    const { ChatGroq } = await import('@langchain/groq');
    const llm = new ChatGroq({
      apiKey: env.groqApiKey,
      model: env.groqSummarizerModel || 'llama-3.3-70b-versatile',
      temperature: 0.2,
      maxRetries: 2,
    });

    const resp = await llm.invoke([
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation:\n\n${transcript}` },
    ]);

    const raw = typeof resp?.content === 'string' ? resp.content : JSON.stringify(resp?.content || '');
    const parsed = parseSummary(raw);
    summaryText = parsed.summary;
    keyFacts = parsed.keyFacts;
  } catch (error) {
    console.error('[SummarizeWorker] LLM summary failed, using fallback:', error.message);
    summaryText = `Conversation of ${messageCount} messages about: ${transcript
      .split('\n')
      .map((l) => l.replace(/^User:|^Coachlix:/, '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' | ')}`;
  }

  // Mark this session as summarised so we wait out the cooldown.
  await markMemoryRun('summary', sessionId);

  topics = [
    /diet|meal|food|nutrition|calorie|protein/i.test(summaryText) ? 'nutrition' : null,
    /workout|exercise|training|gym|strength|cardio/i.test(summaryText) ? 'fitness' : null,
    /weight|fat|muscle|goal/i.test(summaryText) ? 'goals' : null,
  ].filter(Boolean);

  const summary = await ConversationSummary.create({
    userId,
    sessionId,
    scope: 'session',
    summary: summaryText,
    keyFacts,
    topicsCovered: topics,
    windowStart: messages[0]?.timestamp || session.createdAt,
    windowEnd,
    tokenCount: Math.ceil(summaryText.length / 4),
    messageCount,
    dedupKey,
  });

  // Index the summary into Pinecone for cross-session semantic recall.
  await indexMemory(userId, `${summaryText}\n${keyFacts.join('\n')}`, {
    id: `summary_${dedupKey.slice(0, 32)}`,
    type: 'summary',
    sessionId,
    topics,
  });

  const { emitAiEvent } = await import('./eventBus.js');
  await emitAiEvent('conversation.summary.created', {
    userId,
    sessionId,
    summaryId: String(summary._id),
    keyFactCount: keyFacts.length,
    topics,
    messageCount,
  });

  return summary;
}

/**
 * Register the summarizer as an event consumer on the shared event bus.
 */
export function registerSummarizeWorker() {
  const bus = getEventBus();

  const handler = async (event) => {
    if (!event?.payload?.sessionId) return;
    const { sessionId, userId } = event.payload;

    try {
      // Mutually-exclusive per-session turn lock (SET NX): only ONE memory
      // worker (promotion OR summarization) can run per session per gap
      // window, so at most ONE memory LLM call happens per turn.
      if (!(await acquireTurnLock(sessionId))) {
        console.log('[SummarizeWorker] Turn lock held - skipping summarization');
        return;
      }

      // Per-user per-minute budget so a chatty user cannot exhaust the pool.
      if (!(await canSpendMemoryLlmBudgetForUser(userId))) {
        console.log('[SummarizeWorker] Per-user budget exceeded - skipping summarization');
        return;
      }

      await connectMongo();
      const session = await ChatSession.findById(event.payload.sessionId).lean();
      if (session) {
        await summarizeSession(session);
      }
    } catch (error) {
      console.error('[SummarizeWorker] handler error:', error.message);
    }
  };

  // Listen ONLY on the single turn-completion event. The turn lock guarantees
  // mutually-exclusive workers and at most ONE memory LLM call per session per
  // gap window (never after every message).
  bus.on('turn.completed', handler);

  return handler;
}

export default {
  summarizeSession,
  registerSummarizeWorker,
};
