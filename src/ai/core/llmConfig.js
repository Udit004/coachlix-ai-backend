/**
 * LLM Configuration & Initialization
 * Manages LLM setup, model selection, and parameters
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { AI_CONFIG } from '../config/constants.js';

class LLMConfigManager {
  constructor() {
    this.client = null;
    this.models = {};
    this.initialized = false;
    this.modelFallbacks = {};
  }

  /**
   * Initialize LLM client and models
   * @param {string} apiKey - Gemini API key
   */
  async initialize(apiKey) {
    if (this.initialized) return;

    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.initializeModels();
    this.initialized = true;

    console.log('✓ LLM Configuration initialized');
  }

  /**
   * Initialize available models
   */
  initializeModels() {
    this.modelFallbacks = {
      [AI_CONFIG.MODELS.GEMINI_PRO]: [AI_CONFIG.MODELS.GEMINI_FLASH],
      [AI_CONFIG.MODELS.GEMINI_FLASH]: [AI_CONFIG.MODELS.GEMINI_PRO],
    };

    this.models = {
      [AI_CONFIG.MODELS.GEMINI_PRO]: this.client.getGenerativeModel({
        model: AI_CONFIG.MODELS.GEMINI_PRO,
        systemInstruction: this.getSystemPrompt('default'),
      }),
      [AI_CONFIG.MODELS.GEMINI_FLASH]: this.client.getGenerativeModel({
        model: AI_CONFIG.MODELS.GEMINI_FLASH,
        systemInstruction: this.getSystemPrompt('default'),
      }),
    };
  }

  /**
   * Get model instance
   * @param {string} modelName - Model name/key
   * @returns {Object} Model instance
   */
  getModel(modelName = AI_CONFIG.MODELS.GEMINI_FLASH) {
    if (!this.models[modelName]) {
      throw new Error(`Model ${modelName} not found`);
    }
    return this.models[modelName];
  }

  /**
   * Get candidate model names in priority order.
   * @param {string} modelName
   * @returns {string[]}
   */
  getModelCandidates(modelName = AI_CONFIG.MODELS.GEMINI_FLASH) {
    const candidates = [modelName, ...(this.modelFallbacks[modelName] || [])];
    return [...new Set(candidates)].filter((candidate) => this.models[candidate]);
  }

  /**
   * Get system prompt based on context
   * @param {string} context - Context type (default, fitness, diet, etc.)
   * @returns {string} System prompt
   */
  getSystemPrompt(context = 'default') {
    const prompts = {
      default: `You are a knowledgeable fitness and health coaching assistant. 
Your role is to provide personalized diet plans, workout routines, and health advice.
Be empathetic, motivating, and data-driven in your responses.
Always ask clarifying questions when needed.`,

      fitness: `You are an expert fitness coach. Provide workout plans tailored to user goals.
Consider fitness level, available equipment, and time constraints.
Prioritize safety and progressive overload.`,

      diet: `You are a nutrition expert. Create balanced diet plans with appropriate macros.
Consider dietary preferences, allergies, and health conditions.
Provide nutritional guidance based on goals (weight loss, muscle gain, etc.).`,

      health: `You are a health consultant. Provide evidence-based health information.
Always recommend consulting healthcare professionals for medical concerns.
Track and analyze health metrics when relevant.`,
    };

    return prompts[context] || prompts.default;
  }

  /**
   * Get default generation config
   * @returns {Object} Generation configuration
   */
  getGenerationConfig() {
    return {
      temperature: AI_CONFIG.STREAMING.TEMPERATURE,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: AI_CONFIG.STREAMING.MAX_TOKENS,
    };
  }

  /**
   * Get safety settings
   * @returns {Array} Safety settings
   */
  getSafetySettings() {
    return [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
    ];
  }

  /**
   * Verify configuration
   * @returns {boolean} True if properly configured
   */
  isInitialized() {
    return this.initialized && this.client && Object.keys(this.models).length > 0;
  }
}

// Singleton instance
export const llmConfig = new LLMConfigManager();

export default llmConfig;
