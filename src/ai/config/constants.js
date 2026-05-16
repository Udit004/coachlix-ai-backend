/**
 * AI Module Constants
 * Centralized configuration for AI workflows, models, and settings
 */

export const AI_CONFIG = {
  // LLM Models
  MODELS: {
    GEMINI_PRO: 'gemini-2.5-pro',
    GEMINI_FLASH: 'gemini-2.5-flash',
    GEMINI_THINKING: 'gemini-2.5-flash',
  },

  // Intent Types
  INTENTS: {
    GREETING: 'greeting',
    DIET_CREATE: 'diet_create',
    DIET_UPDATE: 'diet_update',
    DIET_VIEW: 'diet_view',
    WORKOUT_CREATE: 'workout_create',
    WORKOUT_UPDATE: 'workout_update',
    HEALTH_METRICS: 'health_metrics',
    NUTRITION_INFO: 'nutrition_info',
    GENERAL_QUESTION: 'general_question',
    CLARIFICATION: 'clarification',
    UNKNOWN: 'unknown',
  },

  // Entity Types
  ENTITIES: {
    FOOD: 'food',
    EXERCISE: 'exercise',
    GOAL: 'goal',
    DURATION: 'duration',
    METRIC: 'metric',
    TIMEFRAME: 'timeframe',
  },

  // Goal Types
  GOALS: {
    WEIGHT_LOSS: 'Weight Loss',
    MUSCLE_GAIN: 'Muscle Gain',
    MAINTENANCE: 'Maintenance',
    CUTTING: 'Cutting',
    BULKING: 'Bulking',
    GENERAL_HEALTH: 'General Health',
  },

  // Streaming
  STREAMING: {
    CHUNK_SIZE: 100,
    MAX_TOKENS: 2000,
    TEMPERATURE: 0.7,
  },

  // Cache
  CACHE_TTL: {
    CONTEXT: 3600, // 1 hour
    MEMORY: 7200, // 2 hours
    INTENT: 1800, // 30 minutes
  },

  // Validation
  VALIDATION: {
    MIN_QUERY_LENGTH: 2,
    MAX_QUERY_LENGTH: 5000,
    MAX_CONTEXT_ITEMS: 10,
  },
};

export const GRAPH_STATES = {
  START: 'START',
  INTENT_CLASSIFICATION: 'INTENT_CLASSIFICATION',
  CONTEXT_RETRIEVAL: 'CONTEXT_RETRIEVAL',
  TOOL_SELECTION: 'TOOL_SELECTION',
  LLM_PROCESSING: 'LLM_PROCESSING',
  RESPONSE_GENERATION: 'RESPONSE_GENERATION',
  END: 'END',
};

export const TOOL_CATEGORIES = {
  DIET: 'diet',
  WORKOUT: 'workout',
  HEALTH: 'health',
  NUTRITION: 'nutrition',
  UTILITY: 'utility',
};

export const ERROR_TYPES = {
  INVALID_INPUT: 'INVALID_INPUT',
  TOOL_ERROR: 'TOOL_ERROR',
  LLM_ERROR: 'LLM_ERROR',
  CONTEXT_ERROR: 'CONTEXT_ERROR',
  MEMORY_ERROR: 'MEMORY_ERROR',
};
