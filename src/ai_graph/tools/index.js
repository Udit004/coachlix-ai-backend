// src/ai/tools/index.js
// REFACTORED: Simple function exports for direct tool calling (no LangChain agent scaffolding)
// Tools vs Dynamic RAG Context:
// - Tools are for ACTIONS: creating, updating, modifying data
// - Context Retrieval (RAG) is for READING: user's existing plans, profile, progress

import { NutritionLookupTool } from './nutritionTool.js';
import { UpdateWorkoutPlanTool } from './workoutTool.js';
import { CreateDietPlanTool, UpdateDietPlanTool } from './dietPlanTool.js';
import { HealthMetricsTool } from './healthMetricsTool.js';
import { FetchDetailsTool } from './fetchDetailsTool.js';
import { webSearch } from '../mcp/searchTool.js';
import { nutritionMcpLookup } from '../mcp/nutritionTool.js';
import { calendarCreateEvent } from '../mcp/calendarTool.js';

// Instantiate tool classes once (for backward compatibility with LangChain if needed)
const nutritionTool = new NutritionLookupTool();
const workoutTool = new UpdateWorkoutPlanTool();
const healthTool = new HealthMetricsTool();
const createDietTool = new CreateDietPlanTool();
const updateDietTool = new UpdateDietPlanTool();
const fetchDetailsTool = new FetchDetailsTool();

/**
 * Simple async function wrappers for direct tool calling
 * These can be called directly without LangChain agent scaffolding
 */

/**
 * Look up nutrition information for a food item
 * @param {string} foodName - Name of the food to look up
 * @param {string} userId - User ID for personalization
 * @returns {Promise<string>} Nutrition information
 */
export async function nutritionLookup({ foodName, userId }) {
  return await nutritionTool._call(JSON.stringify({ foodName, userId }));
}

/**
 * Create or update a workout plan
 * @param {Object} params - Workout plan parameters
 * @param {string} params.userId - User ID (required)
 * @param {string} params.planName - Name of the workout plan
 * @param {Array} params.exercises - Array of exercises
 * @param {number} params.duration - Duration in weeks
 * @param {string} params.difficulty - Difficulty level
 * @param {string} params.goal - Fitness goal
 * @param {string} params.action - Action to perform (get, create, update)
 * @returns {Promise<string>} Workout plan result
 */
export async function updateWorkoutPlan(params) {
  return await workoutTool._call(JSON.stringify(params));
}

/**
 * Calculate health metrics (BMI, BMR, calorie needs)
 * @param {Object} params - Health metric parameters
 * @param {string} params.userId - User ID (required)
 * @param {string} params.action - Action to perform (calculate, get)
 * @returns {Promise<string>} Health metrics result
 */
export async function calculateHealthMetrics(params) {
  return await healthTool._call(JSON.stringify(params));
}

/**
 * Create a new diet plan
 * @param {Object} params - Diet plan parameters
 * @param {string} params.userId - User ID (required)
 * @param {string} params.planName - Name of the diet plan
 * @param {string} params.goal - Fitness goal
 * @param {number} params.targetCalories - Target daily calories
 * @param {number} params.duration - Duration in days
 * @param {Array} params.dietaryRestrictions - Dietary restrictions
 * @returns {Promise<string>} Diet plan creation result
 */
export async function createDietPlan(params) {
  return await createDietTool._call(JSON.stringify(params));
}

/**
 * Update an existing diet plan
 * @param {Object} params - Diet plan update parameters
 * @param {string} params.userId - User ID (required)
 * @param {string} params.planId - Plan ID or planName (required)
 * @param {string} params.action - Action to perform (get, update)
 * @returns {Promise<string>} Diet plan update result
 */
export async function updateDietPlan(params) {
  return await updateDietTool._call(JSON.stringify(params));
}

/**
 * Fetch detailed diet or workout information
 * @param {Object} params - Detail fetch parameters
 * @param {string} params.userId - User ID (required)
 * @param {string} params.type - Type of detail ('diet' or 'workout')
 * @param {string} params.detail - Detail level ('today', 'full', 'specific_day')
 * @param {number} params.dayNumber - Specific day number (optional)
 * @returns {Promise<string>} Detailed information
 */
export async function fetchDetails(params) {
  return await fetchDetailsTool._call(JSON.stringify(params));
}

/**
 * Tool registry for dynamic tool calling
 * Maps tool names to their corresponding functions
 */
export const toolRegistry = {
  'nutrition_lookup': nutritionLookup,
  'web_search': webSearch,
  'nutrition_mcp_lookup': nutritionMcpLookup,
  'update_workout_plan': updateWorkoutPlan,
  'calculate_health_metrics': calculateHealthMetrics,
  'create_diet_plan': createDietPlan,
  'update_diet_plan': updateDietPlan,
  'update_diet_targets': updateDietPlan,
  'replace_diet_day': updateDietPlan,
  'update_diet_meal': updateDietPlan,
  'add_diet_food_item': updateDietPlan,
  'remove_diet_food_item': updateDietPlan,
  'fetch_details': fetchDetails,
  'calendar_create_event': calendarCreateEvent,
};

/**
 * Get tool function by name
 * @param {string} toolName - Name of the tool
 * @returns {Function|null} Tool function or null if not found
 */
export function getToolByName(toolName) {
  return toolRegistry[toolName] || null;
}

/**
 * Get available tool names for LLM prompt
 * @returns {string[]} Array of available tool names
 */
export function getAvailableToolNames() {
  return Object.keys(toolRegistry);
}

/**
 * Get tool descriptions for LLM prompt
 * @returns {string} Formatted tool descriptions
 */
export function getToolDescriptions() {
  return `Available tools:
1. web_search - Search the live internet for current/up-to-date info (no API key needed)
   Required args: { query: string, maxResults?: number }
   Use for recent news, research, current recommendations, athlete info.

2. nutrition_mcp_lookup - Look up LIVE nutrition data from an external DB
   Required args: { foodName: string, quantity?: number }
   Use for branded/packaged/regional foods not in the internal DB.

3. nutrition_lookup - Look up nutrition information for foods
   Required args: { foodName: string, userId: string }

4. update_workout_plan - Create or update workout plans
   Required args: { userId: string, planName?: string, action?: "get"|"create"|"update", exercises?: Array, duration?: number, difficulty?: string, goal?: string }

5. calculate_health_metrics - Calculate BMI, BMR, calorie needs
   Required args: { userId: string, action?: "calculate"|"get" }

6. create_diet_plan - Create new personalized diet plans
   Required args: { userId: string, planName?: string, goal?: string, targetCalories?: number, duration?: number, dietaryRestrictions?: Array }

7. update_diet_targets - Update daily calorie/macro targets or goal of an existing diet plan
   Required args: { userId: string, planId?: string, planName?: string, targetCalories?, targetProtein?, targetCarbs?, targetFats?, goal? }

8. replace_diet_day - Replace ALL meals for one specific day of an existing diet plan
   Required args: { userId: string, planId?: string, planName?: string, dayNumber: number, meals: [{type, items:[{name,calories,protein,carbs,fats,quantity?}]}], waterIntake?, notes? }

9. update_diet_meal - Patch a SINGLE meal type on a specific day (other meals untouched)
   Required args: { userId: string, planId?: string, planName?: string, dayNumber: number, mealType: "Breakfast"|"Lunch"|"Dinner"|"Snacks"|"Pre-Workout"|"Post-Workout", items: [{name,calories,protein,carbs,fats,quantity?}] }

10. add_diet_food_item - Add a single food item to a specific meal on a specific day
   Required args: { userId: string, planId?: string, planName?: string, dayNumber: number, mealType: string, item: {name,calories,protein,carbs,fats,quantity?} }

11. remove_diet_food_item - Remove a specific food item from a meal on a specific day
   Required args: { userId: string, planId?: string, planName?: string, dayNumber: number, mealType: string, foodName: string }

12. fetch_details - Fetch detailed meal or workout information when user needs specifics
    Required args: { userId: string, type: "diet"|"workout", detail?: "today"|"full"|"specific_day", dayNumber?: number }
    Use this when user asks: "What should I eat today?", "Show me my full diet plan", "What exercises today?"

13. calendar_create_event - Create a Google Calendar event for the user
    Required args: { userId: string, summary: string, description?: string, startTime: string, durationMinutes?: number }
    Use this when the LLM wants to schedule a workout or appointment in the user's calendar.`;
}
