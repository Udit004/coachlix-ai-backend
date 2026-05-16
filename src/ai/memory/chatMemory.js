/**
 * Chat Memory Management System
 * Maintains conversation history and context for continuity
 */

import { AI_CONFIG } from '../config/constants.js';
import aiCache from '../core/cache.js';

class ChatMemory {
  constructor() {
    this.sessions = new Map(); // In-memory session storage (can be replaced with DB)
  }

  /**
   * Initialize or get a chat session
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Object} Session object
   */
  async getOrCreateSession(userId, sessionId) {
    // Try cache first
    let session = await aiCache.getCachedMemory(userId, sessionId);

    if (session) {
      return session;
    }

    // Check in-memory storage
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    // Create new session
    session = {
      sessionId,
      userId,
      messages: [],
      context: {
        currentGoal: null,
        currentPlan: null,
        entities: {},
      },
      metadata: {
        created: new Date(),
        lastUpdated: new Date(),
        messageCount: 0,
      },
    };

    this.sessions.set(sessionId, session);
    await aiCache.cacheMemory(userId, sessionId, session);

    return session;
  }

  /**
   * Add message to session
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {Object} message - Message object
   */
  async addMessage(userId, sessionId, message) {
    const session = await this.getOrCreateSession(userId, sessionId);

    const messageObj = {
      id: this.generateMessageId(),
      role: message.role || 'user', // 'user' or 'assistant'
      content: message.content,
      timestamp: new Date(),
      metadata: message.metadata || {},
    };

    session.messages.push(messageObj);
    session.metadata.lastUpdated = new Date();
    session.metadata.messageCount += 1;

    // Keep only last 50 messages to avoid memory bloat
    if (session.messages.length > 50) {
      session.messages = session.messages.slice(-50);
    }

    // Update cache
    await aiCache.cacheMemory(userId, sessionId, session);

    return messageObj;
  }

  /**
   * Get conversation history
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {number} limit - Number of recent messages to retrieve
   * @returns {Array} Message history
   */
  async getHistory(userId, sessionId, limit = 10) {
    const session = await this.getOrCreateSession(userId, sessionId);
    return session.messages.slice(-limit);
  }

  /**
   * Update session context
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {Object} contextUpdate - Context updates
   */
  async updateContext(userId, sessionId, contextUpdate) {
    const session = await this.getOrCreateSession(userId, sessionId);

    session.context = {
      ...session.context,
      ...contextUpdate,
    };

    session.metadata.lastUpdated = new Date();

    await aiCache.cacheMemory(userId, sessionId, session);

    return session.context;
  }

  /**
   * Get session context
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Object} Context
   */
  async getContext(userId, sessionId) {
    const session = await this.getOrCreateSession(userId, sessionId);
    return session.context;
  }

  /**
   * Clear session history
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   */
  async clearHistory(userId, sessionId) {
    const session = await this.getOrCreateSession(userId, sessionId);

    session.messages = [];
    session.context = {
      currentGoal: null,
      currentPlan: null,
      entities: {},
    };
    session.metadata.messageCount = 0;
    session.metadata.lastUpdated = new Date();

    await aiCache.cacheMemory(userId, sessionId, session);
  }

  /**
   * Format conversation for LLM
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {number} maxMessages - Max messages to include
   * @returns {Array} Formatted conversation
   */
  async formatForLLM(userId, sessionId, maxMessages = 10) {
    const history = await this.getHistory(userId, sessionId, maxMessages);

    return history.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Get session summary
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Object} Session summary
   */
  async getSessionSummary(userId, sessionId) {
    const session = await this.getOrCreateSession(userId, sessionId);

    return {
      sessionId,
      userId,
      messageCount: session.metadata.messageCount,
      created: session.metadata.created,
      lastUpdated: session.metadata.lastUpdated,
      context: session.context,
    };
  }

  /**
   * Archive session
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   */
  async archiveSession(userId, sessionId) {
    const session = await this.getOrCreateSession(userId, sessionId);

    session.archived = true;
    session.metadata.archived = new Date();

    this.sessions.delete(sessionId);
    await aiCache.invalidateSessionCache(userId, sessionId);
  }

  /**
   * Generate unique message ID
   * @returns {string} Unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get active session count for user
   * @param {string} userId - User ID
   * @returns {number} Active session count
   */
  getActiveSessionCount(userId) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.archived) {
        count += 1;
      }
    }
    return count;
  }
}

export const chatMemory = new ChatMemory();

export default chatMemory;
