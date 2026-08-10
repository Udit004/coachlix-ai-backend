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
import { createMcpWebSearchTool } from "../../../mcp/searchTool.js";
import { createMcpNutritionLookupTool } from "../../../mcp/nutritionTool.js";
import { createCalendarCreateEventTool } from "../../../mcp/calendarTool.js";
import { env } from "../../../../config/env.js";

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

  // ENHANCED: Append search + external nutrition tools.
  // - web_search needs NO MCP server / API key (DuckDuckGo fallback), so it is
  //   always available when search is enabled — works on Render/localhost.
  // - nutrition_mcp_lookup DOES require an MCP server, so it is only added
  //   when the MCP layer is enabled.
  if (env.mcpSearchEnabled) {
    allTools.push(createMcpWebSearchTool());
  }
  if (env.mcpServersEnabled && env.mcpNutritionEnabled) {
    allTools.push(createMcpNutritionLookupTool());
  }
  // calendar_create_event: uses stored OAuth tokens directly (no MCP server needed
  // as long as the user has connected Google Calendar). Always added when calendar enabled.
  if (env.mcpCalendarEnabled) {
    // userId is injected at runtime per-session; pass null here and override in session context
    allTools.push(createCalendarCreateEventTool(null));
  }

  if (!excludedTools || excludedTools.length === 0) {
    return allTools;
  }

  return allTools.filter((tool) => !excludedTools.includes(tool.name));
}
