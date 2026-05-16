/**
 * Intent Classifier v2
 * Classifies user queries into specific intents for routing and tool selection
 */

import { AI_CONFIG } from '../config/constants.js';
import aiCache from '../core/cache.js';

class IntentClassifier {
  constructor() {
    this.patterns = this.initializePatterns();
    this.confidence_threshold = 0.6;
  }

  /**
   * Initialize intent patterns for classification
   * @returns {Map} Intent patterns
   */
  initializePatterns() {
    return new Map([
      [AI_CONFIG.INTENTS.GREETING, {
        keywords: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good evening'],
        patterns: /^(hello|hi|hey|greetings?|good\s(morning|afternoon|evening))/i,
        priority: 1,
      }],
      [AI_CONFIG.INTENTS.DIET_CREATE, {
        keywords: ['create', 'make', 'generate', 'plan', 'diet', 'meal'],
        patterns: /(create|make|generate|build)\s*(a\s*)?(diet|meal|nutrition)\s*plan/i,
        priority: 8,
      }],
      [AI_CONFIG.INTENTS.DIET_UPDATE, {
        keywords: ['modify', 'update', 'change', 'adjust', 'diet', 'plan'],
        patterns: /(modify|update|change|adjust)\s*(my\s*)?(diet|meal|plan)/i,
        priority: 8,
      }],
      [AI_CONFIG.INTENTS.DIET_VIEW, {
        keywords: ['show', 'view', 'display', 'diet', 'plan'],
        patterns: /(show|view|display|check)\s*(my\s*)?(diet|meal|plan|nutrition)/i,
        priority: 7,
      }],
      [AI_CONFIG.INTENTS.WORKOUT_CREATE, {
        keywords: ['create', 'make', 'generate', 'workout', 'exercise', 'routine'],
        patterns: /(create|make|generate|build)\s*(a\s*)?(workout|exercise|training|routine)/i,
        priority: 8,
      }],
      [AI_CONFIG.INTENTS.WORKOUT_UPDATE, {
        keywords: ['modify', 'update', 'change', 'workout', 'exercise'],
        patterns: /(modify|update|change|adjust)\s*(my\s*)?(workout|exercise|routine)/i,
        priority: 8,
      }],
      [AI_CONFIG.INTENTS.HEALTH_METRICS, {
        keywords: ['health', 'metrics', 'track', 'progress', 'weight', 'calories'],
        patterns: /(health|fitness|progress|track|analyze)\s*(metrics?|progress|data)/i,
        priority: 7,
      }],
      [AI_CONFIG.INTENTS.NUTRITION_INFO, {
        keywords: ['nutrition', 'calories', 'macros', 'protein', 'carbs', 'fat', 'food'],
        patterns: /(nutrition|calor|macro|protein|carbs?|fat)\s*(information|info|about|content)/i,
        priority: 6,
      }],
    ]);
  }

  /**
   * Classify user query intent
   * @param {string} userId - User ID
   * @param {string} query - User query
   * @returns {Promise<Object>} Classification result
   */
  async classify(userId, query) {
    // Check cache first
    const cached = await aiCache.getCachedIntent(userId, query);
    if (cached) {
      return cached;
    }

    const classification = this.performClassification(query);

    // Cache result
    await aiCache.cacheIntent(userId, query, classification);

    return classification;
  }

  /**
   * Perform intent classification
   * @param {string} query - User query
   * @returns {Object} Classification result
   */
  performClassification(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const scores = new Map();

    // Score each intent
    for (const [intent, pattern] of this.patterns.entries()) {
      let score = 0;

      // Pattern matching (highest priority)
      if (pattern.patterns.test(normalizedQuery)) {
        score += pattern.priority * 10;
      }

      // Keyword matching
      for (const keyword of pattern.keywords) {
        if (normalizedQuery.includes(keyword)) {
          score += pattern.priority;
        }
      }

      // Fuzzy matching for partial matches
      score += this.fuzzyScore(normalizedQuery, pattern.keywords);

      if (score > 0) {
        scores.set(intent, score);
      }
    }

    // Find best match
    let bestIntent = AI_CONFIG.INTENTS.UNKNOWN;
    let bestScore = 0;

    for (const [intent, score] of scores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Normalize confidence (0-1)
    const confidence = Math.min(bestScore / 100, 1.0);
    const isConfident = confidence >= this.confidence_threshold;

    return {
      intent: isConfident ? bestIntent : AI_CONFIG.INTENTS.CLARIFICATION,
      confidence,
      topThree: this.getTopThreeIntents(scores),
      query: query.substring(0, 100), // Store truncated query
      timestamp: new Date(),
    };
  }

  /**
   * Calculate fuzzy match score
   * @param {string} query - Query string
   * @param {Array} keywords - Keywords to match
   * @returns {number} Fuzzy score
   */
  fuzzyScore(query, keywords) {
    let score = 0;

    for (const keyword of keywords) {
      const distance = this.levenshteinDistance(query, keyword);
      const similarity = 1 - distance / Math.max(query.length, keyword.length);

      // Only count if similarity > 70%
      if (similarity > 0.7) {
        score += similarity * 2;
      }
    }

    return score;
  }

  /**
   * Levenshtein distance for fuzzy matching
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Get top three intents by score
   * @param {Map} scores - Intent scores
   * @returns {Array} Top three intents with scores
   */
  getTopThreeIntents(scores) {
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([intent, score]) => ({
        intent,
        score: Math.min(score / 100, 1.0),
      }));
  }

  /**
   * Get all available intents
   * @returns {Array} Available intents
   */
  getAvailableIntents() {
    return Array.from(this.patterns.keys());
  }
}

export const intentClassifier = new IntentClassifier();

export default intentClassifier;
