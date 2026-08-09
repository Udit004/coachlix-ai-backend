// src/ai_graph/mcp/nutritionTool.js
// Live nutrition lookup tool via an external MCP server. This works IN ADDITION
// to the internal nutrition_lookup tool — it lets the agent pull live, branded,
// or region-specific food data from an external nutrition database (e.g. Edamam,
// USDA, OpenFoodFacts via MCP) that the internal DB may not have.
//
// Registered into both createGraphTools() and toolRegistry with the distinct
// name "nutrition_mcp_lookup" so it never conflicts with the internal one.

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { callMcpTool, findMcpToolByHint, getMcpStatus } from "./mcpClient.js";
import { env } from "../../config/env.js";

/**
 * Look up live nutrition data through the configured MCP nutrition server.
 * @param {Object} args
 * @param {string} args.foodName - name of the food to look up
 * @param {number} [args.quantity] - portion in grams (default 100)
 * @returns {Promise<string>} nutrition info or a clear error string
 */
export async function nutritionMcpLookup({ foodName, quantity = 100 }) {
  const food = String(foodName || "").trim();

  if (!env.mcpServersEnabled) {
    return `Live nutrition lookup disabled (MCP_SERVERS_ENABLED=false). Using internal nutrition data instead.`;
  }

  if (!food) {
    return `Error: nutrition_mcp_lookup requires a non-empty "foodName".`;
  }

  // Prefer a tool explicitly named like nutrition, else route by server hint.
  const status = getMcpStatus();
  const named = status.tools.find(
    (t) => /nutrition|food|calorie|meal|recipe|usda|edamam/i.test(t.name)
  );

  let result;
  if (named) {
    result = await callMcpTool(named.name, { query: food, foodName: food, quantity });
  } else {
    const byHint = findMcpToolByHint("nutrition");
    if (!byHint) {
      return `Live nutrition lookup error: no nutrition MCP server is configured/connected. Add a nutrition server to MCP_SERVER_URLS.`;
    }
    result = await callMcpTool(byHint.tool.name, {
      query: food,
      foodName: food,
      quantity,
    });
  }

  return result;
}

/**
 * LangChain DynamicStructuredTool for live nutrition lookups via MCP.
 */
export function createMcpNutritionLookupTool() {
  return new DynamicStructuredTool({
    name: "nutrition_mcp_lookup",
    description:
      "Look up LIVE, up-to-date nutrition information (calories, protein, carbs, fats, etc.) for a food " +
      "from an external nutrition database. Use this INSTEAD of the internal nutrition_lookup tool for " +
      "branded items, packaged foods, restaurant dishes, or regional/ethnic foods not present in the " +
      "internal database. For common whole foods you may rely on built-in knowledge.",
    schema: z.object({
      foodName: z
        .string()
        .describe("Name of the food/branded product to look up (e.g. 'McDonald's Big Mac', 'brown rice')"),
      quantity: z
        .number()
        .optional()
        .default(100)
        .describe("Portion size in grams (default 100g)"),
    }),
    func: async ({ foodName, quantity }) =>
      nutritionMcpLookup({ foodName, quantity }),
  });
}

