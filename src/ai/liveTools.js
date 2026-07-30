import { Type } from '@google/genai';
import {
  nutritionLookup,
  updateWorkoutPlan,
  calculateHealthMetrics,
  createDietPlan,
  updateDietPlan,
  fetchDetails
} from '../ai_graph/tools/index.js';

export const liveToolsConfig = [{
  functionDeclarations: [
    {
      name: 'nutrition_lookup',
      description: 'Look up nutrition information for foods',
      parameters: {
        type: Type.OBJECT,
        properties: {
          foodName: { type: Type.STRING, description: 'Name of the food to look up' }
        },
        required: ['foodName']
      }
    },
    {
      name: 'update_workout_plan',
      description: 'Create or update workout plans',
      parameters: {
        type: Type.OBJECT,
        properties: {
          planName: { type: Type.STRING },
          action: { type: Type.STRING, description: '"get", "create", or "update"' },
          duration: { type: Type.INTEGER, description: 'Duration in weeks' },
          difficulty: { type: Type.STRING, description: '"beginner", "intermediate", or "advanced"' },
          goal: { type: Type.STRING }
        }
      }
    },
    {
      name: 'calculate_health_metrics',
      description: 'Calculate BMI, BMR, calorie needs',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: '"calculate" or "get"' }
        }
      }
    },
    {
      name: 'create_diet_plan',
      description: 'Create new personalized diet plans',
      parameters: {
        type: Type.OBJECT,
        properties: {
          planName: { type: Type.STRING },
          goal: { type: Type.STRING },
          targetCalories: { type: Type.INTEGER },
          duration: { type: Type.INTEGER, description: 'Duration in days' }
        }
      }
    },
    {
      name: 'fetch_details',
      description: 'Fetch detailed meal or workout information when user needs specifics',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: '"diet" or "workout"' },
          detail: { type: Type.STRING, description: '"today", "full", or "specific_day"' },
          dayNumber: { type: Type.INTEGER }
        },
        required: ['type']
      }
    }
  ]
}];

export async function executeLiveTool(name, args, userId) {
  try {
    const params = { ...args, userId };
    let result;
    
    switch (name) {
      case 'nutrition_lookup':
        result = await nutritionLookup(params);
        break;
      case 'update_workout_plan':
        result = await updateWorkoutPlan(params);
        break;
      case 'calculate_health_metrics':
        result = await calculateHealthMetrics(params);
        break;
      case 'create_diet_plan':
        result = await createDietPlan(params);
        break;
      case 'update_diet_plan':
        result = await updateDietPlan(params);
        break;
      case 'fetch_details':
        result = await fetchDetails(params);
        break;
      default:
        return { error: `Tool ${name} not found` };
    }
    
    // Attempt to parse string result back into JSON for better Gemini handling
    try {
      if (typeof result === 'string') {
        return JSON.parse(result);
      }
    } catch {
      return { result };
    }
    return result;
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    return { error: error.message || 'Unknown error occurred during tool execution' };
  }
}
