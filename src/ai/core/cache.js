/**
 * AI-specific Cache Management
 * Handles caching for intent classification, context, and memory
 */

import { getCacheValue, setCacheValue, deleteCacheKey } from '../../shared/cache.js';
import { AI_CONFIG } from '../config/constants.js';

class AICacheManager {
  /**
   * Cache intent classification result
   * @param {string} userId - User ID
   * @param {string} query - User query
   * @param {Object} intent - Intent data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheIntent(userId, query, intent, ttl = AI_CONFIG.CACHE_TTL.INTENT) {
    const key = this.getIntentCacheKey(userId, query);
    await setCacheValue(key, ttl, intent);
  }

  /**
   * Get cached intent
   * @param {string} userId - User ID
   * @param {string} query - User query
   * @returns {Object|null} Cached intent or null
   */
  async getCachedIntent(userId, query) {
    const key = this.getIntentCacheKey(userId, query);
    return await getCacheValue(key);
  }

  /**
   * Cache context retrieval result
   * @param {string} userId - User ID
   * @param {string} contextKey - Context identifier
   * @param {Object} context - Context data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheContext(userId, contextKey, context, ttl = AI_CONFIG.CACHE_TTL.CONTEXT) {
    const key = this.getContextCacheKey(userId, contextKey);
    await setCacheValue(key, ttl, context);
  }

  /**
   * Get cached context
   * @param {string} userId - User ID
   * @param {string} contextKey - Context identifier
   * @returns {Object|null} Cached context or null
   */
  async getCachedContext(userId, contextKey) {
    const key = this.getContextCacheKey(userId, contextKey);
    return await getCacheValue(key);
  }

  /**
   * Cache memory snapshot
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {Object} memory - Memory data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheMemory(userId, sessionId, memory, ttl = AI_CONFIG.CACHE_TTL.MEMORY) {
    const key = this.getMemoryCacheKey(userId, sessionId);
    await setCacheValue(key, ttl, memory);
  }

  /**
   * Get cached memory
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Cached memory or null
   */
  async getCachedMemory(userId, sessionId) {
    const key = this.getMemoryCacheKey(userId, sessionId);
    return await getCacheValue(key);
  }

  /**
   * Invalidate user's AI cache
   * @param {string} userId - User ID
   */
  async invalidateUserAICache(userId) {
    const patterns = [
      `ai:intent:${userId}:*`,
      `ai:context:${userId}:*`,
      `ai:memory:${userId}:*`,
    ];

    for (const pattern of patterns) {
      await deleteCacheKey(pattern);
    }
  }

  /**
   * Invalidate session cache
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   */
  async invalidateSessionCache(userId, sessionId) {
    const key = this.getMemoryCacheKey(userId, sessionId);
    await deleteCacheKey(key);
  }

  /**
   * Clear all AI cache (dangerous - use cautiously)
   */
  async clearAllAICache() {
    const patterns = ['ai:intent:*', 'ai:context:*', 'ai:memory:*'];
    for (const pattern of patterns) {
      await deleteCacheKey(pattern);
    }
  }

  // Private helper methods for cache key generation
  getIntentCacheKey(userId, query) {
    const queryHash = this.simpleHash(query);
    return `ai:intent:${userId}:${queryHash}`;
  }

  getContextCacheKey(userId, contextKey) {
    return `ai:context:${userId}:${contextKey}`;
  }

  getMemoryCacheKey(userId, sessionId) {
    return `ai:memory:${userId}:${sessionId}`;
  }

  /**
   * Simple hash function for cache keys
   * @param {string} str - String to hash
   * @returns {string} Hash
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export const aiCache = new AICacheManager();

export default aiCache;
