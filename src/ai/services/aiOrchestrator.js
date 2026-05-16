/**
 * AI Orchestrator Service
 * Central orchestrator that coordinates all AI operations and workflows
 */

import { intentClassifier } from '../reasoning/intentClassifier.js';
import { chatMemory } from '../memory/chatMemory.js';
import { toolRegistry } from '../tools/registry.js';
import { llmConfig } from '../core/llmConfig.js';
import { AI_CONFIG } from '../config/constants.js';

class AIOrchestrator {
  constructor() {
    this.intentClassifier = intentClassifier;
    this.chatMemory = chatMemory;
    this.toolRegistry = toolRegistry;
    this.llmConfig = llmConfig;
  }

  /**
   * Process user message and generate response
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {string} userMessage - User message
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Orchestration result
   */
  async processMessage(userId, sessionId, userMessage, options = {}) {
    try {
      // Step 1: Validate input
      this.validateInput(userMessage);

      // Step 2: Add user message to memory
      await this.chatMemory.addMessage(userId, sessionId, {
        role: 'user',
        content: userMessage,
      });

      // Step 3: Classify intent
      const classification = await this.intentClassifier.classify(userId, userMessage);

      // Step 4: Retrieve context
      const context = await this.chatMemory.getContext(userId, sessionId);
      const history = await this.chatMemory.formatForLLM(userId, sessionId, 10);

      // Step 5: Select tools if needed
      const tools = this.selectTools(classification.intent, context);

      // Step 6: Execute tools if applicable
      let toolResults = null;
      if (tools.length > 0 && options.executeTools !== false) {
        toolResults = await this.executeTools(tools, {
          intent: classification.intent,
          context,
          userId,
        });
      }

      // Step 7: Generate response
      const response = await this.generateResponse(
        userMessage,
        classification,
        context,
        toolResults,
        history
      );

      // Step 8: Add assistant response to memory
      await this.chatMemory.addMessage(userId, sessionId, {
        role: 'assistant',
        content: response.content,
        metadata: {
          intent: classification.intent,
          tools: tools,
        },
      });

      return {
        success: true,
        response: response.content,
        intent: classification.intent,
        confidence: classification.confidence,
        tools: tools,
        metadata: {
          sessionId,
          userId,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      console.error('AI Orchestrator error:', error);

      return {
        success: false,
        error: error.message,
        intent: AI_CONFIG.INTENTS.UNKNOWN,
        metadata: {
          sessionId,
          userId,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Process a message and stream partial output through the provided callback.
   * @param {string} userId
   * @param {string} sessionId
   * @param {string} userMessage
   * @param {Object} options
   * @param {Function} onChunk
   * @returns {Promise<Object>}
   */
  async processMessageStream(userId, sessionId, userMessage, options = {}, onChunk = null) {
    try {
      this.validateInput(userMessage);

      await this.chatMemory.addMessage(userId, sessionId, {
        role: 'user',
        content: userMessage,
      });

      const classification = await this.intentClassifier.classify(userId, userMessage);
      const context = await this.chatMemory.getContext(userId, sessionId);
      const history = await this.chatMemory.formatForLLM(userId, sessionId, 10);
      const tools = this.selectTools(classification.intent, context);

      let toolResults = null;
      if (tools.length > 0 && options.executeTools !== false) {
        toolResults = await this.executeTools(tools, {
          intent: classification.intent,
          context,
          userId,
        });
      }

      const response = await this.generateResponseStream(
        userMessage,
        classification,
        context,
        toolResults,
        history,
        onChunk
      );

      await this.chatMemory.addMessage(userId, sessionId, {
        role: 'assistant',
        content: response.content,
        metadata: {
          intent: classification.intent,
          tools,
        },
      });

      return {
        success: true,
        response: response.content,
        intent: classification.intent,
        confidence: classification.confidence,
        tools,
        metadata: {
          sessionId,
          userId,
          timestamp: new Date(),
          streamed: true,
        },
      };
    } catch (error) {
      console.error('AI Orchestrator streaming error:', error);

      return {
        success: false,
        error: error.message,
        intent: AI_CONFIG.INTENTS.UNKNOWN,
        metadata: {
          sessionId,
          userId,
          timestamp: new Date(),
          streamed: true,
        },
      };
    }
  }

  /**
   * Validate user input
   * @param {string} message - User message
   */
  validateInput(message) {
    if (!message || typeof message !== 'string') {
      throw new Error('Message must be a non-empty string');
    }

    if (message.length < AI_CONFIG.VALIDATION.MIN_QUERY_LENGTH) {
      throw new Error(
        `Message too short (minimum ${AI_CONFIG.VALIDATION.MIN_QUERY_LENGTH} characters)`
      );
    }

    if (message.length > AI_CONFIG.VALIDATION.MAX_QUERY_LENGTH) {
      throw new Error(
        `Message too long (maximum ${AI_CONFIG.VALIDATION.MAX_QUERY_LENGTH} characters)`
      );
    }
  }

  /**
   * Select tools based on intent and context
   * @param {string} intent - Classified intent
   * @param {Object} context - Session context
   * @returns {Array} Selected tool names
   */
  selectTools(intent, context) {
    const selectedTools = [];

    // Map intents to tools
    const intentToolMap = {
      [AI_CONFIG.INTENTS.DIET_CREATE]: 'createDietPlan',
      [AI_CONFIG.INTENTS.DIET_UPDATE]: 'updateDietPlan',
      [AI_CONFIG.INTENTS.WORKOUT_CREATE]: 'createWorkoutPlan',
      [AI_CONFIG.INTENTS.WORKOUT_UPDATE]: 'updateWorkoutPlan',
      [AI_CONFIG.INTENTS.HEALTH_METRICS]: 'calculateHealthMetrics',
      [AI_CONFIG.INTENTS.NUTRITION_INFO]: 'nutritionLookup',
    };

    const tool = intentToolMap[intent];

    if (tool && this.toolRegistry.exists(tool)) {
      selectedTools.push(tool);
    }

    return selectedTools;
  }

  /**
   * Execute selected tools
   * @param {Array} tools - Tool names
   * @param {Object} context - Execution context
   * @returns {Promise<Array>} Tool execution results
   */
  async executeTools(tools, context) {
    const results = [];

    for (const toolName of tools) {
      try {
        const result = await this.toolRegistry.execute(toolName, {}, context);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          tool: toolName,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Generate LLM response
   * @param {string} userMessage - Original user message
   * @param {Object} classification - Intent classification
   * @param {Object} context - Session context
   * @param {Array} toolResults - Tool execution results
   * @param {Array} history - Conversation history
   * @returns {Promise<Object>} Generated response
   */
  async generateResponse(userMessage, classification, context, toolResults, history) {
    const prompt = this.buildPrompt(
      userMessage,
      classification.intent,
      context,
      toolResults,
      history
    );

    const { textContent } = await this.generateWithModelFallback(
      async (model) => {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: this.llmConfig.getGenerationConfig(),
          safetySettings: this.llmConfig.getSafetySettings(),
        });

        return {
          textContent: result.response.text(),
        };
      }
    );

    return {
      content: textContent,
      intent: classification.intent,
    };
  }

  /**
   * Generate streaming LLM response.
   * Falls back to non-streaming generation if the provider stream is unavailable.
   * @param {string} userMessage
   * @param {Object} classification
   * @param {Object} context
   * @param {Array} toolResults
   * @param {Array} history
   * @param {Function|null} onChunk
   * @returns {Promise<Object>}
   */
  async generateResponseStream(
    userMessage,
    classification,
    context,
    toolResults,
    history,
    onChunk = null
  ) {
    const prompt = this.buildPrompt(
      userMessage,
      classification.intent,
      context,
      toolResults,
      history
    );

    let fullContent = '';
    const { textContent, usedStreaming } = await this.generateWithModelFallback(async (model) => {
      if (typeof model.generateContentStream === 'function') {
        const result = await model.generateContentStream({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: this.llmConfig.getGenerationConfig(),
          safetySettings: this.llmConfig.getSafetySettings(),
        });

        let streamedContent = '';

        for await (const chunk of result.stream) {
          const text = chunk?.text?.() || '';
          if (!text) {
            continue;
          }

          streamedContent += text;
          if (onChunk) {
            await onChunk({
              text,
              partialResponse: streamedContent,
            });
          }
        }

        if (!streamedContent) {
          const finalResponse = await result.response;
          streamedContent = finalResponse?.text?.() || '';
        }

        return { textContent: streamedContent, usedStreaming: true };
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: this.llmConfig.getGenerationConfig(),
        safetySettings: this.llmConfig.getSafetySettings(),
      });

      return {
        textContent: result.response.text(),
        usedStreaming: false,
      };
    });

    fullContent = textContent;

    if (onChunk && fullContent && !usedStreaming) {
      let partialResponse = '';
      for (const token of this.chunkText(fullContent)) {
        partialResponse += token;
        await onChunk({
          text: token,
          partialResponse,
        });
      }
    }

    return {
      content: fullContent,
      intent: classification.intent,
    };
  }

  /**
   * Run a generation operation against the primary model and configured fallbacks.
   * @param {(model: any, modelName: string) => Promise<any>} operation
   * @returns {Promise<any>}
   */
  async generateWithModelFallback(operation) {
    const candidateModels = this.llmConfig.getModelCandidates(AI_CONFIG.MODELS.GEMINI_FLASH);
    let lastError = null;

    for (const modelName of candidateModels) {
      try {
        const model = this.llmConfig.getModel(modelName);
        return await operation(model, modelName);
      } catch (error) {
        lastError = error;
        console.warn(`[AI Orchestrator] Model ${modelName} failed: ${error.message}`);
      }
    }

    throw lastError || new Error('No configured Gemini model succeeded');
  }

  /**
   * Build prompt for LLM
   * @param {string} userMessage - User message
   * @param {string} intent - Intent
   * @param {Object} context - Context
   * @param {Array} toolResults - Tool results
   * @param {Array} history - Conversation history
   * @returns {string} Built prompt
   */
  buildPrompt(userMessage, intent, context, toolResults, history) {
    let prompt = `You are a professional fitness and health coaching assistant.

Current Intent: ${intent}
User Message: "${userMessage}"

`;

    // Add context if available
    if (context.currentGoal) {
      prompt += `User's Goal: ${context.currentGoal}\n`;
    }

    if (context.currentPlan) {
      prompt += `Current Plan: ${context.currentPlan}\n`;
    }

    // Add tool results if available
    if (toolResults && toolResults.length > 0) {
      prompt += '\nRelevant Information:\n';
      for (const result of toolResults) {
        if (result.success && result.data) {
          prompt += `- ${JSON.stringify(result.data)}\n`;
        }
      }
    }

    // Add conversation history summary
    if (history && history.length > 0) {
      prompt += '\nRecent Conversation:\n';
      for (const msg of history.slice(-5)) {
        prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      }
    }

    prompt += '\nProvide a helpful, personalized response based on the context above.';

    return prompt;
  }

  /**
   * Split plain text into SSE-friendly chunks when streaming fallback is needed.
   * @param {string} text
   * @returns {string[]}
   */
  chunkText(text) {
    const matches = text.match(/\S+\s*/g);
    return matches && matches.length > 0 ? matches : [text];
  }

  /**
   * Get session status
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Session status
   */
  async getSessionStatus(userId, sessionId) {
    const summary = await this.chatMemory.getSessionSummary(userId, sessionId);

    return {
      ...summary,
      toolCount: this.toolRegistry.count(),
      intents: this.intentClassifier.getAvailableIntents(),
    };
  }

  /**
   * Clear session
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   */
  async clearSession(userId, sessionId) {
    await this.chatMemory.clearHistory(userId, sessionId);
  }
}

export const aiOrchestrator = new AIOrchestrator();

export default aiOrchestrator;
