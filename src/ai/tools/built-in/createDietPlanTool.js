/**
 * Create Diet Plan Tool
 * Handles diet plan creation based on user parameters
 */

import { TOOL_CATEGORIES, AI_CONFIG } from '../../config/constants.js';
import DietPlan from '../../../models/DietPlan.js';

export const createDietPlanTool = {
  category: TOOL_CATEGORIES.DIET,
  description: 'Creates a personalized diet plan based on user goals, duration, and preferences',
  tags: ['diet', 'plan', 'nutrition', 'meal'],

  schema: {
    userId: { type: 'string', required: true },
    goal: { type: 'string', required: true },
    duration: { type: 'number', required: true },
    targetCalories: { type: 'number', required: false },
    dietaryPreference: { type: 'string', required: false },
  },

  /**
   * Execute diet plan creation
   * @param {Object} inputs - Tool inputs
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Created diet plan
   */
  async execute(inputs, context = {}) {
    const { userId, goal, duration, targetCalories, dietaryPreference } = inputs;

    if (!userId) {
      throw new Error('userId is required');
    }

    if (!goal || !Object.values(AI_CONFIG.GOALS).includes(goal)) {
      throw new Error('Invalid goal. Must be one of: ' + Object.values(AI_CONFIG.GOALS).join(', '));
    }

    if (!duration || duration < 1 || duration > 365) {
      throw new Error('Duration must be between 1 and 365 days');
    }

    // Create basic diet plan structure
    const dietPlan = new DietPlan({
      userId,
      name: `AI Generated ${goal} Plan`,
      description: `${duration}-day personalized ${goal.toLowerCase()} diet plan`,
      goal,
      duration,
      targetCalories: targetCalories || this.getDefaultCalories(goal),
      targetProtein: this.calculateMacro(targetCalories || this.getDefaultCalories(goal), 0.3),
      targetCarbs: this.calculateMacro(targetCalories || this.getDefaultCalories(goal), 0.45),
      targetFats: this.calculateMacro(targetCalories || this.getDefaultCalories(goal), 0.25),
      difficulty: this.getDifficulty(goal),
      tags: [goal.toLowerCase(), `${duration}day`],
      createdBy: 'ai',
      isActive: false,
    });

    await dietPlan.save();

    return {
      planId: dietPlan._id,
      name: dietPlan.name,
      goal: dietPlan.goal,
      duration: dietPlan.duration,
      targetCalories: dietPlan.targetCalories,
      message: `Created ${duration}-day ${goal} diet plan successfully`,
    };
  },

  /**
   * Get default calories based on goal
   * @param {string} goal - Goal type
   * @returns {number} Default calories
   */
  getDefaultCalories(goal) {
    const defaults = {
      'Weight Loss': 1800,
      'Muscle Gain': 2500,
      Maintenance: 2200,
      Cutting: 1800,
      Bulking: 2800,
      'General Health': 2200,
    };
    return defaults[goal] || 2200;
  },

  /**
   * Calculate macro intake
   * @param {number} calories - Daily calories
   * @param {number} percentage - Percentage of calories
   * @returns {number} Macro in grams
   */
  calculateMacro(calories, percentage) {
    return Math.round((calories * percentage) / 4); // Protein & Carbs = 4 cal/g
  },

  /**
   * Get difficulty based on goal
   * @param {string} goal - Goal type
   * @returns {string} Difficulty level
   */
  getDifficulty(goal) {
    const difficulties = {
      'Weight Loss': 'Intermediate',
      'Muscle Gain': 'Advanced',
      Maintenance: 'Beginner',
      Cutting: 'Advanced',
      Bulking: 'Intermediate',
      'General Health': 'Beginner',
    };
    return difficulties[goal] || 'Beginner';
  },
};

export default createDietPlanTool;
