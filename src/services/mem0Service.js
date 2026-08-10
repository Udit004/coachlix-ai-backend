import { MemoryClient } from 'mem0ai';

import { env } from '../config/env.js';

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
      userId,
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

  try {
    const response = await client.search(query, {
      topK,
      userId,
    });

    return {
      results: (response?.results || []).map(mapMemory),
      source: 'mem0',
      provider: 'mem0',
      cacheHit: false,
    };
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

  try {
    const response = await client.getAll({
      page: 1,
      pageSize,
      latestOnly: true,
      userId,
    });

    return (response?.results || []).map(mapMemory);
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

export default {
  isMem0Enabled,
  getMem0Client,
  addTurnMemories,
  searchMemories,
  getUserMemories,
  buildMem0Context,
};
