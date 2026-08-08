// src/services/memoryPromotionPipeline.js
// Background memory promotion pipeline. After each completed turn/session it:
//  1. Extracts candidate stable facts from the conversation via Gemini.
//  2. Promotes confident facts into UserMemoryFact (idempotent).
//  3. Primes the Redis hot cache with the most recent promoted facts.
// Runs off the hot path (event-driven).
//
// To avoid exhausting the Gemini rate limit, this pipeline is throttled:
//   - trivial/error-only/short conversations skip extraction entirely
//   - a per-session cooldown prevents re-running the LLM on every turn
//   - cheap heuristic extraction (no LLM) handles common Coachlix patterns
//   - the LLM is only used when heuristics find nothing AND budget remains

import { env } from '../config/env.js';
import { getEventBus } from './eventBus.js';
import { connectMongo } from '../db/mongo.js';
import ChatSession from '../models/ChatSession.js';
import {
  promoteFact,
  getRecentFacts,
  primeHotCache,
} from './longTermMemoryService.js';
import {
  canSpendMemoryLlmBudget,
  canSpendMemoryLlmBudgetForUser,
  acquireTurnLock,
  markMemoryRun,
  isWithinCooldown,
  isMemoryWorthy,
  heuristicExtractFacts,
} from './memoryThrottle.js';

const EXTRACTION_PROMPT = `You are a memory extraction agent for Coachlix, an AI fitness coach.
Read the conversation transcript and extract STABLE, durable facts worth remembering across sessions.
Only extract facts that are:
- Repeatedly stated or clearly stable preferences/goals/constraints
- Injuries, allergies, dietary restrictions, schedule, equipment, disliked foods
- Long-term fitness goals or progress that matters later

Do NOT extract one-off questions, greetings, or transient small talk.

Return STRICT JSON array only, no markdown:
[
  {
    "fact": "the normalized fact statement",
    "type": "goal|preference|constraint|injury|schedule|entity",
    "confidence": 0.0-1.0,
    "tags": ["tag1","tag2"]
  }
]`;

function extractJsonArray(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] || text;
  const first = candidate.indexOf('[');
  const last = candidate.lastIndexOf(']');
  if (first === -1 || last === -1 || last <= first) return [];

  try {
    const parsed = JSON.parse(candidate.slice(first, last + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Extract candidate facts from a transcript using the LLM.
 */
async function extractFacts(transcript) {
  if (!transcript?.trim()) return [];

  try {
    const { ChatGroq } = await import('@langchain/groq');
    const llm = new ChatGroq({
      apiKey: env.groqApiKey,
      model: env.groqIntentModel || 'llama-3.1-8b-instant',
      temperature: 0,
      maxRetries: 2,
    });

    const resp = await llm.invoke([
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Conversation:\n\n${transcript}` },
    ]);

    const raw = typeof resp?.content === 'string' ? resp.content : JSON.stringify(resp?.content || '');
    return extractJsonArray(raw);
  } catch (error) {
    console.error('[MemoryPipeline] extraction error:', error.message);
    return [];
  }
}

/**
 * Run the promotion pipeline for a session.
 */
export async function runMemoryPromotion(session) {
  if (!session?._id) return { promoted: 0 };

  const userId = session.userId;
  const sessionId = String(session._id);
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Coachlix'}: ${String(m.content || '').slice(0, 400)}`)
    .join('\n');

  if (!transcript.trim()) return { promoted: 0 };

  // Skip if the conversation is trivial / error-only / too short to matter.
  if (!isMemoryWorthy(messages, { minMessages: 2 })) {
    return { promoted: 0, skipped: 'not-memory-worthy' };
  }

  // Respect the per-session cooldown so we don't call the LLM on every turn.
  if (await isWithinCooldown('promotion', sessionId)) {
    return { promoted: 0, skipped: 'cooldown' };
  }

  // Try cheap heuristic extraction first (no LLM call). If it captures the
  // common Coachlix patterns, we can skip the LLM entirely.
  let candidates = heuristicExtractFacts(messages);

  // Only fall back to the LLM when heuristic found nothing AND we still have
  // budget for a memory LLM call this minute.
  if (candidates.length === 0) {
    if (await canSpendMemoryLlmBudget()) {
      candidates = await extractFacts(transcript);
    }
  }

  // Mark this session as processed so we wait out the cooldown before the
  // next LLM call for the same conversation.
  await markMemoryRun('promotion', sessionId);

  const promotionThreshold = env.memoryPromotionThreshold || 3;

  let promoted = 0;
  const promotedItems = [];

  for (const candidate of candidates.slice(0, 8)) {
    const confidence = Number(candidate.confidence);
    const safeConfidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
    const type = String(candidate.type || 'entity').toLowerCase();
    const factText = String(candidate.fact || '').trim();

    if (!factText) continue;
    if (!['goal', 'preference', 'constraint', 'injury', 'schedule', 'entity'].includes(type)) {
      continue;
    }

    // Only promote high-confidence facts; others need repeated observation.
    if (safeConfidence < 0.6) {
      const existing = await attemptObservationIncrement(userId, type, factText);
      if (existing?.observationCount >= promotionThreshold) {
        await promoteFact({
          userId,
          factType: type,
          content: factText,
          confidence: Math.max(safeConfidence, existing.confidence || 0.5),
          source: 'conversation',
          tags: Array.isArray(candidate.tags) ? candidate.tags : [],
        });
        promoted++;
        promotedItems.push(factText);
      }
      continue;
    }

    await promoteFact({
      userId,
      factType: type,
      content: factText,
      confidence: safeConfidence,
      source: 'conversation',
      tags: Array.isArray(candidate.tags) ? candidate.tags : [],
    });
    promoted++;
    promotedItems.push(factText);
  }

  // Prime the hot cache with the most recent facts for faster retrieval.
  if (promoted > 0) {
    const recent = await getRecentFacts(userId, 5);
    await primeHotCache(
      userId,
      recent.map((f) => ({
        id: String(f._id),
        content: `[${f.factType}] ${f.content}`,
        type: 'fact',
        score: f.confidence || 0.5,
      }))
    );
  }

  return { promoted, promotedItems };
}

/**
 * Increment observation count for a low-confidence candidate using its hash.
 * This avoids creating a fact until it's observed enough times.
 */
async function attemptObservationIncrement(userId, factType, content) {
  const { computeFactHash } = await import('./longTermMemoryService.js');
  const hash = computeFactHash(factType, content);

  // Track repeated observations in a lightweight way. We look for a partially
  // matched fact; if none exists we just return null (no durable write yet).
  // For a real implementation you'd maintain an observation tally — here we
  // rely on the promoteFact path for high-confidence facts.
  const existing = await trackObservation(userId, factType, content, hash);
  return existing;
}

/**
 * Lightweight observation tally stored alongside facts. We keep this simple:
 * reuse the UserMemoryFact doc when it exists, else store a transient counter.
 */
async function trackObservation(userId, factType, content, factHash) {
  const UserMemoryFact = (await import('../models/UserMemoryFact.js')).default;
  await connectMongo();

  // If a fact already exists with this hash, bump it via promoteFact's logic.
  const existing = await UserMemoryFact.findOne({ factHash });
  if (existing) {
    existing.observationCount = (existing.observationCount || 1) + 1;
    await existing.save();
    return existing;
  }

  // Store a transient observation record (not a promoted fact yet).
  const ObservationModel =
    UserMemoryFact.db.models.UserMemoryObservation ||
    UserMemoryFact.db.model(
      'UserMemoryObservation',
      new UserMemoryFact.db.base.Schema(
        {
          userId,
          factType,
          content,
          factHash: { type: String, unique: true },
          count: { type: Number, default: 1 },
          updatedAt: { type: Date, default: Date.now },
        },
        { timestamps: true }
      )
    );

  const doc = await ObservationModel.findOneAndUpdate(
    { factHash },
    { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  if (doc.count >= (env.memoryPromotionThreshold || 3)) {
    // Promote once we cross the threshold.
    return { _id: doc._id, observationCount: doc.count, confidence: 0.5 };
  }

  return { _id: doc._id, observationCount: doc.count, confidence: 0.5 };
}

/**
 * Register the promotion pipeline as an event consumer.
 */
export function registerMemoryPromotionPipeline() {
  const bus = getEventBus();

  const handler = async (event) => {
    if (!event?.payload?.sessionId) return;
    const { sessionId, userId } = event.payload;

    try {
      // Mutually-exclusive per-session turn lock (SET NX): only ONE memory
      // worker (promotion OR summarization) can run per session per gap
      // window, so at most ONE memory LLM call happens per turn.
      if (!(await acquireTurnLock(sessionId))) {
        console.log('[MemoryPipeline] Turn lock held - skipping promotion');
        return;
      }

      // Per-user per-minute budget so a chatty user cannot exhaust the pool.
      if (!(await canSpendMemoryLlmBudgetForUser(userId))) {
        console.log('[MemoryPipeline] Per-user budget exceeded - skipping promotion');
        return;
      }

      await connectMongo();
      const session = await ChatSession.findById(event.payload.sessionId).lean();
      if (session) {
        await runMemoryPromotion(session);
      }
    } catch (error) {
      console.error('[MemoryPipeline] handler error:', error.message);
    }
  };

  // Listen ONLY on the single turn-completion event. The turn lock guarantees
  // mutually-exclusive workers and at most ONE memory LLM call per session per
  // gap window (never after every message).
  bus.on('turn.completed', handler);

  return handler;
}

export default {
  runMemoryPromotion,
  registerMemoryPromotionPipeline,
};
