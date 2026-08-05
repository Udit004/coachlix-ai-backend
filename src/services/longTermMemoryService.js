// src/services/longTermMemoryService.js
// Long-term memory service layered on Pinecone (vector) + MongoDB (durable
// facts/summaries) + Redis (hot cache). Retrieval re-ranks vector hits with
// Redis-cached hot items and falls back to MongoDB facts when vector search
// is unavailable. Promotion is idempotent via a fact hash.

import crypto from 'node:crypto';

import UserMemoryFact from '../models/UserMemoryFact.js';
import ConversationSummary from '../models/ConversationSummary.js';
import { connectMongo } from '../db/mongo.js';
import { cache } from '../lib/redis.js';
import { env } from '../config/env.js';
import { emitAiEvent } from './eventBus.js';
import {
  isPineconeEnabled,
  getPineconeIndex,
  getEmbeddings,
} from './pineconeClient.js';

const NAMESPACE = () => env.pineconeMemoryNamespace || 'memory';

const factKey = (userId) => `longterm:fact:${userId}`;
const profileKey = (userId) => `longterm:profile:${userId}`;
const hotCacheKey = (userId) => `longterm:hot:${userId}`;

export function computeFactHash(factType, content) {
  return crypto
    .createHash('sha256')
    .update(`${factType}::${String(content || '').trim().toLowerCase()}`)
    .digest('hex');
}

const safeJsonParse = (value, fallback) => {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

/**
 * Upsert a memory vector into Pinecone (per-user metadata + namespace).
 */
export async function indexMemory(userId, text, metadata = {}) {
  if (!userId || !text) return false;
  if (!isPineconeEnabled()) return false;

  try {
    const embeddings = getEmbeddings();
    const index = getPineconeIndex();
    if (!embeddings || !index) return false;

    const embedding = await embeddings.embedQuery(String(text).slice(0, 8000));
    const vectorId = metadata.id || `mem_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await index.upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: {
          userId,
          type: metadata.type || 'memory',
          content: String(text).slice(0, 2000),
          ...metadata,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    await emitAiEvent('memory.vector.indexed', {
      userId,
      vectorId,
      type: metadata.type || 'memory',
    });

    return true;
  } catch (error) {
    console.error('[LongTermMemory] indexMemory error:', error.message);
    return false;
  }
}

/**
 * Delete a memory vector from Pinecone.
 */
export async function deleteMemoryVector(vectorId) {
  if (!vectorId || !isPineconeEnabled()) return false;
  try {
    const index = getPineconeIndex();
    if (!index) return false;
    await index.deleteOne(vectorId);
    return true;
  } catch (error) {
    console.error('[LongTermMemory] deleteMemoryVector error:', error.message);
    return false;
  }
}

/**
 * Retrieve semantically similar memories for a user.
 * 1. Check Redis hot cache (recently accessed memory chunks).
 * 2. Run Pinecone vector search.
 * 3. Re-rank: merge hot cached items with vector hits, dropping dupes.
 * 4. Fall back to MongoDB facts when vector search is unavailable/empty.
 */
export async function retrieveMemory(userId, query, { topK } = {}) {
  const k = topK || env.memoryVectorTopK || 5;
  if (!userId || !query) return { results: [], source: 'none' };

  let cacheHit = false;
  let vectorResults = [];

  // 1. Try Pinecone vector search.
  if (isPineconeEnabled()) {
    try {
      const embeddings = getEmbeddings();
      const index = getPineconeIndex();
      if (embeddings && index) {
        const queryEmbedding = await embeddings.embedQuery(String(query).slice(0, 8000));
        const response = await index.query({
          vector: queryEmbedding,
          topK: k * 2,
          includeMetadata: true,
          filter: { userId: { $eq: userId } },
          namespace: NAMESPACE(),
        });

        vectorResults = (response?.matches || [])
          .filter((m) => m.score != null)
          .map((m) => ({
            id: m.id,
            score: m.score,
            content: m.metadata?.content || '',
            type: m.metadata?.type || 'memory',
            vectorId: m.id,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
      }
    } catch (error) {
      console.error('[LongTermMemory] vector search error:', error.message);
    }
  }

  // 2. Load hot cached items from Redis.
  let hotItems = [];
  try {
    const raw = await cache.get(hotCacheKey(userId));
    hotItems = safeJsonParse(raw, []);
    cacheHit = Array.isArray(hotItems) && hotItems.length > 0;
  } catch {
    cacheHit = false;
  }

  // 3. Re-rank: merge vector + hot items, dedupe by content.
  const merged = [...hotItems, ...vectorResults];
  const seen = new Set();
  const ranked = [];
  for (const item of merged) {
    const dedupeKey = item.content || item.id || '';
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    ranked.push(item);
  }
  const results = ranked.slice(0, k);

  // 4. Fallback to MongoDB facts if we have nothing.
  if (results.length === 0) {
    const facts = await getRecentFacts(userId, k);
    if (facts.length > 0) {
      return {
        results: facts.map((f) => ({
          id: String(f._id),
          score: f.confidence || 0.5,
          content: f.content,
          type: f.factType || 'fact',
        })),
        source: 'mongo',
        cacheHit,
      };
    }
  }

  await emitAiEvent(cacheHit ? 'memory.cache.hit' : 'memory.cache.miss', {
    userId,
    resultCount: results.length,
  });

  return {
    results,
    source: results.length > 0 ? (cacheHit ? 'cache' : 'vector') : 'none',
    cacheHit,
  };
}

/**
 * Persist a durable fact (idempotent via factHash). Updates observation count
 * and confidence when the same fact is observed again.
 */
export async function promoteFact({
  userId,
  factType,
  content,
  confidence = 0.6,
  source = 'conversation',
  tags = [],
}) {
  if (!userId || !content) return null;

  await connectMongo();
  const factHash = computeFactHash(factType, content);
  const normalized = String(content).trim();

  const existing = await UserMemoryFact.findOne({ factHash });

  if (existing) {
    existing.observationCount = (existing.observationCount || 1) + 1;
    existing.confidence = Math.min(1, Math.max(existing.confidence || 0.5, confidence));
    existing.lastSeenAt = new Date();
    await existing.save();
    return existing;
  }

  const fact = await UserMemoryFact.create({
    userId,
    factType,
    content: normalized,
    confidence,
    observationCount: 1,
    source,
    tags,
    factHash,
    lastSeenAt: new Date(),
  });

  // Index the fact into Pinecone for semantic recall.
  await indexMemory(userId, `[${factType}] ${normalized}`, {
    id: `fact_${factHash.slice(0, 24)}`,
    type: 'fact',
    factType,
    tags,
  });

  await emitAiEvent('memory.long_term.promoted', {
    userId,
    factType,
    factId: String(fact._id),
    confidence,
  });

  return fact;
}

/**
 * Get the most recent/confident durable facts for a user directly from MongoDB.
 */
export async function getRecentFacts(userId, limit = 5) {
  if (!userId) return [];
  try {
    await connectMongo();
    return await UserMemoryFact.find({ userId, isActive: true })
      .sort({ confidence: -1, lastSeenAt: -1 })
      .limit(limit)
      .lean();
  } catch (error) {
    console.error('[LongTermMemory] getRecentFacts error:', error.message);
    return [];
  }
}

/**
 * Build (and cache in Redis) a consolidated user memory profile from durable
 * facts, grouped by factType, for injection into prompts.
 */
export async function getUserMemoryProfile(userId) {
  if (!userId) return null;

  try {
    const cached = await cache.get(profileKey(userId));
    if (cached) return safeJsonParse(cached, null);

    await connectMongo();
    const facts = await UserMemoryFact.find({ userId, isActive: true })
      .sort({ confidence: -1 })
      .limit(50)
      .lean();

    if (facts.length === 0) return null;

    const grouped = {};
    for (const fact of facts) {
      const type = fact.factType || 'fact';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push({
        content: fact.content,
        confidence: fact.confidence,
        tags: fact.tags || [],
      });
    }

    const profile = {
      userId,
      facts: facts.map((f) => ({
        id: String(f._id),
        factType: f.factType,
        content: f.content,
        confidence: f.confidence,
        tags: f.tags || [],
      })),
      grouped,
      updatedAt: new Date().toISOString(),
    };

    await cache.set(profileKey(userId), JSON.stringify(profile), env.memoryProfileTtlSeconds);
    return profile;
  } catch (error) {
    console.error('[LongTermMemory] getUserMemoryProfile error:', error.message);
    return null;
  }
}

/**
 * Prime the Redis hot cache with the given memory items for fast re-ranking.
 */
export async function primeHotCache(userId, items) {
  if (!userId || !Array.isArray(items) || items.length === 0) return false;
  try {
    await cache.set(hotCacheKey(userId), JSON.stringify(items.slice(0, 10)), env.memoryHotCacheTtlSeconds);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Format a memory profile + recalled memories into a compact prompt section.
 */
export function formatMemoryForContext(memoryProfile, recalled) {
  const lines = [];

  if (recalled?.results?.length > 0) {
    lines.push('=== LONG-TERM MEMORY (from past conversations) ===');
    recalled.results.slice(0, 5).forEach((r) => {
      if (r.content) lines.push(`- ${r.content}`);
    });
  }

  if (memoryProfile?.grouped) {
    for (const [type, facts] of Object.entries(memoryProfile.grouped)) {
      lines.push(`[${type}] ${facts.slice(0, 3).map((f) => f.content).join('; ')}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

export default {
  computeFactHash,
  indexMemory,
  deleteMemoryVector,
  retrieveMemory,
  promoteFact,
  getRecentFacts,
  getUserMemoryProfile,
  primeHotCache,
  formatMemoryForContext,
};
