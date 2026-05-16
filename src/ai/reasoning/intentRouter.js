/**
 * Intent Router
 * Routes classified intents to appropriate handlers/tools
 */

import { AI_CONFIG } from '../config/constants.js';

class IntentRouter {
  constructor() {
    this.routes = this.initializeRoutes();
  }

  /**
   * Initialize intent routes
   * @returns {Map} Intent to handler mapping
   */
  initializeRoutes() {
    return new Map([
      [AI_CONFIG.INTENTS.GREETING, 'handleGreeting'],
      [AI_CONFIG.INTENTS.DIET_CREATE, 'handleDietCreate'],
      [AI_CONFIG.INTENTS.DIET_UPDATE, 'handleDietUpdate'],
      [AI_CONFIG.INTENTS.DIET_VIEW, 'handleDietView'],
      [AI_CONFIG.INTENTS.WORKOUT_CREATE, 'handleWorkoutCreate'],
      [AI_CONFIG.INTENTS.WORKOUT_UPDATE, 'handleWorkoutUpdate'],
      [AI_CONFIG.INTENTS.HEALTH_METRICS, 'handleHealthMetrics'],
      [AI_CONFIG.INTENTS.NUTRITION_INFO, 'handleNutritionInfo'],
      [AI_CONFIG.INTENTS.CLARIFICATION, 'handleClarification'],
      [AI_CONFIG.INTENTS.UNKNOWN, 'handleUnknown'],
    ]);
  }

  /**
   * Route intent to handler
   * @param {string} intent - Intent to route
   * @param {Object} context - Routing context
   * @returns {Object} Routing result
   */
  async route(intent, context = {}) {
    const handler = this.routes.get(intent);

    if (!handler) {
      return {
        success: false,
        error: `No route found for intent: ${intent}`,
      };
    }

    return {
      success: true,
      handler,
      context,
    };
  }

  /**
   * Get available routes
   * @returns {Array} Available intents and their handlers
   */
  getRoutes() {
    return Array.from(this.routes.entries()).map(([intent, handler]) => ({
      intent,
      handler,
    }));
  }
}

export const intentRouter = new IntentRouter();

export default intentRouter;
