import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";

/**
 * OpenRouter configuration (OpenAI-compatible gateway).
 * Used as a powerful FREE fallback for text/tool-calling reasoning when
 * Gemini 2.5 Flash is unavailable or rate-limited. The Nemotron 3 Super 120B
 * free model supports tool-calling and structured outputs.
 */
export const OPENROUTER_CONFIG = {
  baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
  // Primary free model: strong tool-calling + structured outputs.
  model:
    process.env.OPENROUTER_MODEL?.trim() ||
    "nvidia/nemotron-3-super-120b-a12b:free",
  // Fallback free models if the primary is unavailable / rate-limited.
  fallbackModels: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-20b:free",
  ],
  temperature: 0.2,
  apiKey: process.env.OPENROUTER_API_KEY?.trim(),
};

/**
 * Create a ChatOpenAI instance pointed at OpenRouter (OpenAI-compatible).
 * @param {boolean} streaming - Enable streaming mode
 * @param {Object} overrides - Override default config (e.g. { model })
 * @returns {ChatOpenAI}
 */
export function createOpenRouterLLM(streaming = true, overrides = {}) {
  const { model: overrideModel, temperature: overrideTemp, ...restOverrides } = overrides;
  return new ChatOpenAI({
    apiKey: OPENROUTER_CONFIG.apiKey,
    model: overrideModel || OPENROUTER_CONFIG.model,
    temperature: overrideTemp ?? OPENROUTER_CONFIG.temperature,
    maxRetries: 0,
    streaming,
    configuration: {
      baseURL: OPENROUTER_CONFIG.baseURL,
    },
    ...restOverrides,
  });
}

/**
 * Create a ChatOpenAI instance pointed at OpenRouter with a specific model.
 * @param {string} model - OpenRouter model ID
 * @returns {ChatOpenAI}
 */
export function createOpenRouterModelLLM(model) {
  return createOpenRouterLLM(true, { model });
}

/**
 * LLM Configuration for Gemini 2.5 Flash with function calling
 */
export const LLM_CONFIG = {
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxOutputTokens: 2048,  // Increased for detailed recipes and comprehensive responses
  topP: 0.9,
  topK: 40,
  safetySettings: [
    {
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_ONLY_HIGH",  // Less restrictive for helpful content
    },
    {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_ONLY_HIGH",  // Allow cooking instructions and recipes
    },
  ],
};

/**
 * Create a ChatGoogleGenerativeAI instance with proper configuration
 * @param {boolean} streaming - Enable streaming mode
 * @param {Object} overrides - Override default config
 * @returns {ChatGoogleGenerativeAI}
 */
export function createStreamingLLM(streaming = true, overrides = {}) {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY?.trim(),
    model: LLM_CONFIG.model,
    temperature: LLM_CONFIG.temperature,
    maxOutputTokens: LLM_CONFIG.maxOutputTokens,
    topP: LLM_CONFIG.topP,
    topK: LLM_CONFIG.topK,
    streaming: streaming,
    ...overrides
  });
}

/**
 * Create a Gemini 2.5 Flash instance explicitly (multimodal / offload path).
 * Equivalent to createStreamingLLM but named for clarity when used as the
 * fallback for Groq 70B rate-limit exhaustion.
 * @param {boolean} streaming - Enable streaming mode
 * @param {Object} overrides - Override default config
 * @returns {ChatGoogleGenerativeAI}
 */
export function createGeminiFlashLLM(streaming = true, overrides = {}) {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY?.trim(),
    model:
      process.env.GEMINI_FLASH_MODEL?.trim() ||
      process.env.GENERAL_QUERY_MODEL?.trim() ||
      "gemini-2.5-flash",
    temperature: LLM_CONFIG.temperature,
    maxOutputTokens: LLM_CONFIG.maxOutputTokens,
    topP: LLM_CONFIG.topP,
    topK: LLM_CONFIG.topK,
    streaming: streaming,
    ...overrides
  });
}

/**
 * Create LLM with Google Search grounding enabled
 * Allows Gemini to search the internet for real-time information
 * 
 * @param {boolean} streaming - Enable streaming mode
 * @param {Object} searchConfig - Search grounding configuration
 * @returns {ChatGoogleGenerativeAI}
 */
export function createLLMWithSearch(streaming = true, searchConfig = {}) {
  const {
    threshold = 0.7,
    maxResults = 5
  } = searchConfig;
  
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY?.trim(),
    model: LLM_CONFIG.model,
    temperature: LLM_CONFIG.temperature,
    maxOutputTokens: LLM_CONFIG.maxOutputTokens,
    topP: LLM_CONFIG.topP,
    topK: LLM_CONFIG.topK,
    streaming: streaming,
    // Enable Google Search grounding
    tools: [{
      googleSearchRetrieval: {
        dynamicRetrievalConfig: {
          mode: 'MODE_DYNAMIC',
          dynamicThreshold: threshold
        }
      }
    }]
  });
}

/**
 * Create a ChatGroq instance for reasoning/intent tasks
 * @param {boolean} streaming - Enable streaming mode
 * @param {Object} overrides - Override default config
 * @returns {ChatGroq}
 */
export function createGroqLLM(streaming = false, overrides = {}) {
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY?.trim(),
    model: overrides.model || 'llama-3.1-8b-instant',
    temperature: overrides.temperature ?? 0,
    maxRetries: overrides.maxRetries ?? 2,
    streaming: streaming,
    ...overrides
  });
}