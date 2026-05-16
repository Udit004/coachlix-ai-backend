/**
 * AI Module - Main Export
 * Aggregates and exports all AI services, utilities, and components
 */

// Core
import { llmConfig } from './core/llmConfig.js';
import { aiCache } from './core/cache.js';

// Configuration
import { AI_CONFIG, GRAPH_STATES, TOOL_CATEGORIES, ERROR_TYPES } from './config/constants.js';

// Reasoning
import { intentClassifier } from './reasoning/intentClassifier.js';

// Tools
import { toolRegistry } from './tools/registry.js';

// Memory
import { chatMemory } from './memory/chatMemory.js';

// Services
import { aiOrchestrator } from './services/aiOrchestrator.js';

export { llmConfig, aiCache };
export { AI_CONFIG, GRAPH_STATES, TOOL_CATEGORIES, ERROR_TYPES };
export { intentClassifier };
export { toolRegistry };
export { chatMemory };
export { aiOrchestrator };

/**
 * Initialize AI Module
 * Call this during application startup
 * @param {Object} config - Configuration options
 * @param {string} config.geminiApiKey - Gemini API key
 * @returns {Promise<void>}
 */
export async function initializeAI(config) {
  try {
    // Initialize LLM
    if (config.geminiApiKey) {
      await llmConfig.initialize(config.geminiApiKey);
    }

    console.log('✓ AI Module initialized successfully');
  } catch (error) {
    console.error('Failed to initialize AI Module:', error);
    throw error;
  }
}

/**
 * Register custom tools
 * @param {Object} tools - Tools to register
 * @example
 * registerCustomTools({
 *   myTool: {
 *     category: 'utility',
 *     description: 'My custom tool',
 *     execute: async (inputs) => { ... },
 *   }
 * })
 */
export function registerCustomTools(tools) {
  for (const [name, config] of Object.entries(tools)) {
    toolRegistry.register(name, config);
  }
}

export default {
  // Core services
  aiOrchestrator,
  intentClassifier,
  chatMemory,
  toolRegistry,
  llmConfig,
  aiCache,

  // Configuration
  AI_CONFIG,
  GRAPH_STATES,
  TOOL_CATEGORIES,
  ERROR_TYPES,

  // Functions
  initializeAI,
  registerCustomTools,
};
