// src/ai/graph/fitness/tools/index.js

import { createNutritionLookupTool } from "./nutritionLookupTool.js";
import { createUpdateWorkoutPlanTool } from "./updateWorkoutPlanTool.js";
import { createCalculateHealthMetricsTool } from "./calculateHealthMetricsTool.js";
import { createCreateDietPlanTool } from "./createDietPlanTool.js";
import {
  createUpdateDietTargetsTool,
  createReplaceDayTool,
  createUpdateMealTool,
  createAddFoodItemTool,
  createRemoveFoodItemTool,
} from "./updateDietPlanTool.js";
import { createFetchDetailsTool } from "./fetchDetailsTool.js";

export function createGraphTools(excludedTools = []) {
  const allTools = [
    createNutritionLookupTool(),
    createUpdateWorkoutPlanTool(),
    createCalculateHealthMetricsTool(),
    createCreateDietPlanTool(),
    createUpdateDietTargetsTool(),
    createReplaceDayTool(),
    createUpdateMealTool(),
    createAddFoodItemTool(),
    createRemoveFoodItemTool(),
    createFetchDetailsTool(),
  ];

  if (!excludedTools || excludedTools.length === 0) {
    return allTools;
  }

  return allTools.filter((tool) => !excludedTools.includes(tool.name));
}
