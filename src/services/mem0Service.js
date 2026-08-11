import { MemoryClient } from 'mem0ai';

import { env } from '../config/env.js';
import { cache } from '../lib/redis.js';

let mem0Client = null;

function hasUsableMem0ApiKey() {
  const key = String(env.mem0ApiKey || '').trim();
  if (!key) return false;

  const placeholders = new Set([
    'your_mem0_key',
    'mem0_api_key',
    'replace_me',
    'changeme',
    'test',
  ]);

  return !placeholders.has(key.toLowerCase());
}

export function isMem0Enabled() {
  return env.memoryProvider === 'mem0' && Boolean(env.mem0Enabled) && hasUsableMem0ApiKey();
}

export async function getMem0Client() {
  if (!isMem0Enabled()) {
    return null;
  }

  if (!mem0Client) {
    const host = String(env.mem0BaseUrl || env.mem0ApiHost || '').trim() || undefined;
    mem0Client = new MemoryClient({
      apiKey: env.mem0ApiKey,
      host,
    });
  }

  return mem0Client;
}

function normalizeMessages(messages = []) {
  return messages
    .filter((message) => message?.role && message?.content)
    .map((message) => ({
      role: message.role === 'ai' ? 'assistant' : message.role,
      content: String(message.content),
    }))
    .filter((message) => message.role === 'user' || message.role === 'assistant');
}

function mapMemory(item) {
  return {
    id: item.id,
    content: item.memory || item.data?.memory || '',
    score: item.score ?? 0,
    type: item.memoryType || 'memory',
    metadata: item.metadata || {},
    categories: item.categories || [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function buildProfile(memories = []) {
  if (!memories.length) return null;

  const grouped = {};
  for (const memory of memories) {
    const group = memory.categories?.[0] || memory.metadata?.source || 'memory';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({
      content: memory.content,
      confidence: memory.score ?? 0.5,
      tags: memory.categories || [],
    });
  }

  return {
    facts: memories.map((memory) => ({
      id: memory.id,
      factType: memory.type || 'memory',
      content: memory.content,
      confidence: memory.score ?? 0.5,
      tags: memory.categories || [],
    })),
    grouped,
    updatedAt: new Date().toISOString(),
  };
}

function memorySearchCacheKey(userId, query, topK) {
  return `mem0:search:${userId}:${topK}:${query.trim().toLowerCase()}`;
}

function memoryProfileCacheKey(userId) {
  return `mem0:profile:${userId}`;
}

export async function addTurnMemories(userId, messages, metadata = {}) {
  const client = await getMem0Client();
  if (!client || !userId) {
    return { results: [] };
  }

  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) {
    return { results: [] };
  }

  try {
    const results = await client.add(normalized, {
      filters: { user_id: userId },
      metadata,
    });

    return {
      results: Array.isArray(results) ? results.map(mapMemory) : [],
    };
  } catch (error) {
    console.error('[Mem0] addTurnMemories failed:', error?.message || error);
    return { results: [] };
  }
}

export async function searchMemories(userId, query, topK = 5) {
  const client = await getMem0Client();
  if (!client || !userId || !query) {
    return { results: [], source: 'none', provider: 'mem0' };
  }

  const trimmedQuery = String(query).trim();
  const cacheKey = memorySearchCacheKey(userId, trimmedQuery, topK);
  const cached = await cache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      cacheHit: true,
    };
  }

  try {
    const response = await client.search(trimmedQuery, {
      topK,
      filters: { user_id: userId },
    });

    const result = {
      results: (response?.results || []).map(mapMemory),
      source: 'mem0',
      provider: 'mem0',
      cacheHit: false,
    };

    await cache.set(cacheKey, result, 300);
    return result;
  } catch (error) {
    console.error('[Mem0] searchMemories failed:', error?.message || error);
    return {
      results: [],
      source: 'error',
      provider: 'mem0',
      cacheHit: false,
    };
  }
}

export async function getUserMemories(userId, pageSize = 12) {
  const client = await getMem0Client();
  if (!client || !userId) {
    return [];
  }

  const cacheKey = memoryProfileCacheKey(userId);
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await client.getAll({
      page: 1,
      pageSize,
      latestOnly: true,
      filters: { user_id: userId },
    });

    const memories = (response?.results || []).map(mapMemory);
    await cache.set(cacheKey, memories, 1800);
    return memories;
  } catch (error) {
    console.error('[Mem0] getUserMemories failed:', error?.message || error);
    return [];
  }
}

export async function buildMem0Context(userId, query, topK = 5) {
  const [recalled, userMemories] = await Promise.all([
    searchMemories(userId, query, topK),
    getUserMemories(userId, 12),
  ]);

  const memoryProfile = buildProfile(userMemories);
  const lines = [];

  if (recalled.results.length > 0) {
    lines.push('=== LONG-TERM MEMORY (Mem0) ===');
    recalled.results.slice(0, topK).forEach((memory) => {
      if (memory.content) lines.push(`- ${memory.content}`);
    });
  }

  if (memoryProfile?.grouped) {
    for (const [group, memories] of Object.entries(memoryProfile.grouped)) {
      lines.push(`[${group}] ${memories.slice(0, 3).map((memory) => memory.content).join('; ')}`);
    }
  }

  return {
    memoryProfile,
    recalled,
    text: lines.join('\n'),
  };
}

export async function updateMemoriesForPreference(userId, oldPreference, newPreference) {
  const client = await getMem0Client();
  if (!client || !userId || !oldPreference || !newPreference) {
    return { updated: 0 };
  }

  try {
    const searchResult = await client.search(oldPreference, {
      topK: 5,
      filters: { user_id: userId },
    });

    const memories = searchResult?.results || [];
    const matches = memories.filter((m) =>
      (m.memory || m.data?.memory || '').toLowerCase().includes(oldPreference.toLowerCase())
    );

    let updated = 0;
    for (const memory of matches) {
      try {
        const oldText = memory.memory || memory.data?.memory || '';
        const updatedText = oldText.replace(new RegExp(oldPreference, 'gi'), newPreference);
        if (updatedText !== oldText) {
          await client.update(memory.id, { text: updatedText });
          updated++;
        }
      } catch (updateError) {
        console.error('[Mem0] updateMemoriesForPreference item failed:', updateError?.message || updateError);
      }
    }

    return { updated };
  } catch (error) {
    console.error('[Mem0] updateMemoriesForPreference failed:', error?.message || error);
    return { updated: 0 };
  }
}

export default {
  isMem0Enabled,
  getMem0Client,
  addTurnMemories,
  searchMemories,
  getUserMemories,
  buildMem0Context,
  updateMemoriesForPreference,
};
