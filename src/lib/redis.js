import { Redis } from '@upstash/redis';

import { env } from '../config/env.js';

let redisClient = null;

if (env.upstashRedisRestUrl && env.upstashRedisRestToken) {
  redisClient = new Redis({
    url: env.upstashRedisRestUrl,
    token: env.upstashRedisRestToken,
  });
}

export const redis = redisClient;

export const cache = {
  get: async (key) => (redis ? redis.get(key) : null),
  set: async (key, value, expirationSeconds) => {
    if (!redis) return null;
    if (expirationSeconds) {
      return redis.setex(key, expirationSeconds, value);
    }
    return redis.set(key, value);
  },
  // Atomically set a key ONLY if it does not already exist (SET NX).
  // Used for turn locks so exactly one memory worker can acquire it per
  // session per gap window. Returns true when the key was set (acquired).
  setIfAbsent: async (key, value, expirationSeconds) => {
    if (!redis) return false;
    try {
      const options = expirationSeconds
        ? { ex: expirationSeconds, nx: true }
        : { nx: true };
      const result = await redis.set(key, value, options);
      // Upstash returns 'OK' on success and null on an NX failure.
      return result === 'OK' || result === true;
    } catch (error) {
      console.error('[Redis] setIfAbsent failed:', error?.message || error);
      return false;
    }
  },
  delete: async (key) => (redis ? redis.del(key) : null),
  clear: async () => {
    if (!redis) return null;
    return redis.flushdb();
  },
};
