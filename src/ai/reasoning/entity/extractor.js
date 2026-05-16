/**
 * Entity Extractor
 * Extracts named entities from user queries
 * Examples: food items, exercises, durations, goals, etc.
 */

import { AI_CONFIG } from '../../config/constants.js';

class EntityExtractor {
  constructor() {
    this.patterns = this.initializePatterns();
  }

  /**
   * Initialize entity patterns
   * @returns {Object} Entity patterns
   */
  initializePatterns() {
    return {
      [AI_CONFIG.ENTITIES.FOOD]: {
        keywords: ['chicken', 'rice', 'broccoli', 'salmon', 'egg', 'oats', 'protein'],
        regex: /(?:(?:eat|consume|have|add|include)\s+)?([\w\s]+)(?:\s+(?:for|as|in|with))?/i,
      },
      [AI_CONFIG.ENTITIES.EXERCISE]: {
        keywords: ['push-up', 'squat', 'running', 'swimming', 'yoga', 'weightlifting'],
        regex: /(?:(?:do|perform|exercises?|workout)\s+)?([\w\s]+)/i,
      },
      [AI_CONFIG.ENTITIES.DURATION]: {
        keywords: /(\d+)\s*(?:day|week|month|hour|minute)/gi,
        regex: /(\d+)\s*(?:day|week|month|hour|minute)s?/i,
      },
      [AI_CONFIG.ENTITIES.GOAL]: {
        keywords: Object.values(AI_CONFIG.GOALS),
        regex: new RegExp(`(${Object.values(AI_CONFIG.GOALS).join('|')})`, 'i'),
      },
    };
  }

  /**
   * Extract entities from query
   * @param {string} query - User query
   * @returns {Object} Extracted entities
   */
  extract(query) {
    const entities = {};

    for (const [entityType, pattern] of Object.entries(this.patterns)) {
      entities[entityType] = this.findEntity(query, entityType, pattern);
    }

    return entities;
  }

  /**
   * Find entity in query
   * @param {string} query - Query text
   * @param {string} entityType - Entity type
   * @param {Object} pattern - Pattern to match
   * @returns {Array} Found entities
   */
  findEntity(query, entityType, pattern) {
    const found = [];
    const normalizedQuery = query.toLowerCase();

    // Check keywords
    if (pattern.keywords) {
      const keywords = Array.isArray(pattern.keywords) ? pattern.keywords : [pattern.keywords];
      for (const keyword of keywords) {
        if (typeof keyword === 'string' && normalizedQuery.includes(keyword)) {
          found.push({
            value: keyword,
            entityType,
            confidence: 0.9,
          });
        }
      }
    }

    // Check regex
    if (pattern.regex && found.length === 0) {
      const matches = query.match(pattern.regex);
      if (matches) {
        found.push({
          value: matches[1] || matches[0],
          entityType,
          confidence: 0.7,
        });
      }
    }

    return found;
  }

  /**
   * Extract all entities from query
   * @param {string} query - Query text
   * @returns {Array} All extracted entities
   */
  extractAll(query) {
    const allEntities = [];
    const entities = this.extract(query);

    for (const [entityType, found] of Object.entries(entities)) {
      allEntities.push(...found);
    }

    return allEntities.sort((a, b) => b.confidence - a.confidence);
  }
}

export const entityExtractor = new EntityExtractor();

export default entityExtractor;
