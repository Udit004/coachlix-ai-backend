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
  delete: async (key) => (redis ? redis.del(key) : null),
  clear: async () => {
    if (!redis) return null;
    return redis.flushdb();
  },
};
