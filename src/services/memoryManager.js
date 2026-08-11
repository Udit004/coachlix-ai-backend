import { emitAiEvent } from './eventBus.js';
import {
  retrieveMemory as retrieveLegacyMemory,
  getUserMemoryProfile,
  formatMemoryForContext,
  promoteFact,
  getRecentFacts,
  primeHotCache,
} from './longTermMemoryService.js';
// import { extractStructuredMemories } from './langmemCompatibilityService.js';
import { env } from '../config/env.js';
import { addTurnMemories, buildMem0Context, isMem0Enabled, updateMemoriesForPreference } from './mem0Service.js';

function providerMode() {
  return env.memoryProvider || 'mem0';
}

function isHybridProvider() {
  return providerMode() === 'hybrid';
}

async function buildLegacyContext(userId, query) {
  const [memoryProfile, recalled] = await Promise.all([
    getUserMemoryProfile(userId),
    retrieveLegacyMemory(userId, query),
  ]);

  return {
    memoryProfile,
    recalled,
    text: formatMemoryForContext(memoryProfile, recalled),
  };
}

export async function retrieveMemory(userId, query, options = {}) {
  if (isMem0Enabled()) {
    const context = await buildMem0Context(userId, query, options.topK || env.memoryVectorTopK || 5);
    if (context.recalled?.results?.length > 0 || !env.memoryLegacyLongTermEnabled) {
      return context.recalled;
    }
  }

  if (!env.memoryLegacyLongTermEnabled) {
    return {
      results: [],
      source: 'disabled',
      cacheHit: false,
      provider: providerMode(),
    };
  }

  const recalled = await retrieveLegacyMemory(userId, query, options);

  if (!isHybridProvider() || !env.memoryLangmemCompatRetrievalEnabled) {
    return recalled;
  }

  return {
    ...recalled,
    provider: 'hybrid',
  };
}

export async function buildLongTermMemoryContext(userId, query) {
  if (!userId) {
    return {
      memoryProfile: null,
      recalled: { results: [], source: 'none', provider: providerMode() },
      text: '',
    };
  }

  if (isMem0Enabled()) {
    const mem0Context = await buildMem0Context(userId, query, env.memoryVectorTopK || 5);
    const hasMem0Data =
      Boolean(mem0Context.text?.trim()) ||
      Boolean(mem0Context.memoryProfile) ||
      (mem0Context.recalled?.results?.length || 0) > 0;

    if (hasMem0Data || !env.memoryLegacyLongTermEnabled) {
      return mem0Context;
    }
  }

  if (!env.memoryLegacyLongTermEnabled) {
    return {
      memoryProfile: null,
      recalled: { results: [], source: 'disabled', provider: providerMode() },
      text: '',
    };
  }

  return buildLegacyContext(userId, query);
}

export async function promoteStructuredMemories({
  userId,
  transcript,
  messages = [],
  source = 'conversation',
}) {
  if (isMem0Enabled()) {
    const result = await addTurnMemories(userId, messages, { source, transcriptLength: transcript?.length || 0 });
    const promotedItems = result.results.map((item) => item.content).filter(Boolean);

    if (promotedItems.length > 0) {
      await emitAiEvent('memory.long_term.promoted', {
        userId,
        provider: 'mem0',
        promotedCount: promotedItems.length,
      });
    }

    return { promoted: promotedItems.length, promotedItems };
  }

  if (!isHybridProvider() || !env.memoryLegacyLongTermEnabled) {
    return { promoted: 0, promotedItems: [] };
  }

  const candidates = await extractStructuredMemories(transcript);
  if (candidates.length === 0) {
    return { promoted: 0, promotedItems: [] };
  }

  let promoted = 0;
  const promotedItems = [];

  for (const candidate of candidates) {
    await promoteFact({
      userId,
      factType: candidate.type,
      content: candidate.fact,
      confidence: candidate.confidence,
      source: `${source}:langmem-compat`,
      tags: candidate.tags,
    });
    promoted += 1;
    promotedItems.push(candidate.fact);
  }

  if (promoted > 0) {
    const recent = await getRecentFacts(userId, 5);
    await primeHotCache(
      userId,
      recent.map((fact) => ({
        id: String(fact._id),
        content: `[${fact.factType}] ${fact.content}`,
        type: 'fact',
        score: fact.confidence || 0.5,
      }))
    );
  }

  return { promoted, promotedItems };
}

export { updateMemoriesForPreference };

export default {
  retrieveMemory,
  buildLongTermMemoryContext,
  promoteStructuredMemories,
  updateMemoriesForPreference,
};
