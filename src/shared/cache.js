import { Redis } from '@upstash/redis';

import { env } from '../config/env.js';

let redisClient = null;

function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) {
    return null;
  }

  redisClient = new Redis({
    url: env.upstashRedisRestUrl,
    token: env.upstashRedisRestToken
  });

  return redisClient;
}

export async function getCacheValue(key) {
  const client = getRedisClient();
  if (!client) return null;
  return client.get(key);
}

export async function setCacheValue(key, ttlSeconds, value) {
  const client = getRedisClient();
  if (!client) return false;

  if (ttlSeconds) {
    await client.setex(key, ttlSeconds, value);
  } else {
    await client.set(key, value);
  }

  return true;
}

export async function deleteCacheKey(key) {
  const client = getRedisClient();
  if (!client) return false;
  await client.del(key);
  return true;
}

export async function findCacheKeys(pattern) {
  const client = getRedisClient();
  if (!client) return [];
  return client.keys(pattern);
}

// Export redis client for direct access
export const redis = {
  get: async (key) => {
    const client = getRedisClient();
    if (!client) return null;
    return client.get(key);
  },
  set: async (key, value, mode, ttl) => {
    const client = getRedisClient();
    if (!client) return false;
    
    if (mode === "EX" && ttl) {
      await client.setex(key, ttl, value);
    } else {
      await client.set(key, value);
    }
    
    return true;
  },
  del: async (key) => {
    const client = getRedisClient();
    if (!client) return false;
    await client.del(key);
    return true;
  },
  keys: async (pattern) => {
    const client = getRedisClient();
    if (!client) return [];
    return client.keys(pattern);
  }
};