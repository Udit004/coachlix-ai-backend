// src/ai/graph/fitness/tools/updateDietPlanTool.js
//
// SPLIT INTO 5 SMALL SINGLE-PURPOSE TOOLS.
//
// The previous monolithic `update_diet_plan` tool had 5 deeply-nested operation
// objects, which produced a JSON-Schema with `$ref` references that Gemini
// rejects with a 400 error, and which Groq 70B could not reliably emit valid
// tool calls for. By splitting into one tiny schema per operation, each tool
// is trivially easy for the model to call and avoids `$ref`.

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toolRegistry } from "../../../tools/index.js";

// NOTE: To avoid `$ref` references in the generated JSON-Schema (which Gemini
// rejects with a 400 "Unknown name \"$ref\"" error), we MUST NOT reuse the same
// zod schema instance across multiple fields/tools. `zod-to-json-schema`
// deduplicates reused instances by emitting `$ref`, which Gemini cannot parse.
// Every schema element below is therefore created fresh via a factory function.

function toNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

// Fresh number instance per call (no shared instance -> no $ref).
const numOrStr = () => z.number();

// Fresh enum instance per call (no shared instance -> no $ref).
const mealTypeEnum = () =>
  z.enum([
    "Breakfast",
    "Lunch",
    "Dinner",
    "Snacks",
    "Pre-Workout",
    "Post-Workout",
  ]);

// Fresh food-item object per call (no shared instance -> no $ref).
const foodItemSchema = () =>
  z.object({
    name: z.string().describe("Food item name"),
    calories: z.number().describe("Calories in kcal"),
    protein: z.number().describe("Protein in grams"),
    carbs: z.number().describe("Carbs in grams"),
    fats: z.number().describe("Fats in grams"),
    quantity: z.string().optional().describe("e.g. '1 cup', '200g'"),
  });

/**
 * Update plan-level targets (calories / macros / goal).
 * Small schema -> easy for the model to emit valid tool calls.
 */
export function createUpdateDietTargetsTool() {
  return new DynamicStructuredTool({
    name: "update_diet_targets",
    description:
      "Update the daily calorie/macro targets or goal of an existing diet plan. " +
      "Use when the user wants to change their daily calories, protein, carbs, fats, or goal.",
    schema: z.object({
      userId: z.string().describe("User ID (required)"),
      planId: z
        .string()
        .optional()
        .describe("MongoDB plan _id from the PRELOADED PLAN DATA. ALWAYS pass this when updating."),
      planName: z
        .string()
        .optional()
        .describe("Plan name fallback - only if planId is unavailable"),
      targetCalories: numOrStr().optional().describe("New daily calorie target"),
      targetProtein: numOrStr().optional().describe("New daily protein target in grams"),
      targetCarbs: numOrStr().optional().describe("New daily carbs target in grams"),
      targetFats: numOrStr().optional().describe("New daily fats target in grams"),
      goal: z
        .string()
        .optional()
        .describe("Updated goal: weight_loss, muscle_gain, maintenance, cutting, or bulking"),
    }),
    func: async ({ userId, planId, planName, targetCalories, targetProtein, targetCarbs, targetFats, goal }) =>
      toolRegistry.update_diet_plan({
        userId,
        planId,
        planName,
        action: "update",
        targetCalories: toNumber(targetCalories),
        targetProtein: toNumber(targetProtein),
        targetCarbs: toNumber(targetCarbs),
        targetFats: toNumber(targetFats),
        goal,
      }),
  });
}

/**
 * Replace ALL meals for a single day.
 */
export function createReplaceDayTool() {
  return new DynamicStructuredTool({
    name: "replace_diet_day",
    description:
      "Replace ALL meals for one specific day of an existing diet plan. " +
      "Use only when rewriting the whole day. For changing just one meal type, use update_diet_meal instead.",
    schema: z.object({
      userId: z.string().describe("User ID (required)"),
      planId: z
        .string()
        .optional()
        .describe("MongoDB plan _id from the PRELOADED PLAN DATA. ALWAYS pass this when updating."),
      planName: z
        .string()
        .optional()
        .describe("Plan name fallback - only if planId is unavailable"),
      dayNumber: z.number().describe("1-based day index to replace (e.g. 1 for Day 1)"),
      meals: z
        .array(
          z.object({
            type: mealTypeEnum().describe("Meal type"),
            items: z.array(foodItemSchema()).describe("Food items in this meal"),
          })
        )
        .describe("Complete new meals array for this day (replaces existing meals entirely)"),
      waterIntake: numOrStr().optional().describe("Water intake in litres"),
      notes: z.string().optional().describe("Notes for this day"),
    }),
    func: async ({ userId, planId, planName, dayNumber, meals, waterIntake, notes }) =>
      toolRegistry.update_diet_plan({
        userId,
        planId,
        planName,
        action: "update",
        updateDay: {
          dayNumber: toNumber(dayNumber),
          meals,
          waterIntake: toNumber(waterIntake),
          notes,
        },
      }),
  });
}

/**
 * Patch a SINGLE meal type on a specific day (other meals untouched).
 */
export function createUpdateMealTool() {
  return new DynamicStructuredTool({
    name: "update_diet_meal",
    description:
      "Patch a SINGLE meal type on a specific day of an existing diet plan without touching other meals. " +
      "Example: change only Lunch on Day 1. Preferred operation for partial day updates.",
    schema: z.object({
      userId: z.string().describe("User ID (required)"),
      planId: z
        .string()
        .optional()
        .describe("MongoDB plan _id from the PRELOADED PLAN DATA. ALWAYS pass this when updating."),
      planName: z
        .string()
        .optional()
        .describe("Plan name fallback - only if planId is unavailable"),
      dayNumber: z.number().describe("1-based day index"),
      mealType: mealTypeEnum().describe("Exactly which meal to replace on that day"),
      items: z.array(foodItemSchema()).describe("New food items for this meal (replaces only this meal type)"),
    }),
    func: async ({ userId, planId, planName, dayNumber, mealType, items }) =>
      toolRegistry.update_diet_plan({
        userId,
        planId,
        planName,
        action: "update",
        updateMeal: {
          dayNumber: toNumber(dayNumber),
          mealType,
          items,
        },
      }),
  });
}

/**
 * Add a single food item to a specific meal on a specific day.
 */
export function createAddFoodItemTool() {
  return new DynamicStructuredTool({
    name: "add_diet_food_item",
    description:
      "Add a single food item to a specific meal on a specific day of an existing diet plan. " +
      "Example: add a boiled egg to Breakfast on Day 3.",
    schema: z.object({
      userId: z.string().describe("User ID (required)"),
      planId: z
        .string()
        .optional()
        .describe("MongoDB plan _id from the PRELOADED PLAN DATA. ALWAYS pass this when updating."),
      planName: z
        .string()
        .optional()
        .describe("Plan name fallback - only if planId is unavailable"),
      dayNumber: z.number().describe("1-based day index"),
      mealType: mealTypeEnum().describe("Meal to add the item to"),
      item: foodItemSchema().describe("The food item to add"),
    }),
    func: async ({ userId, planId, planName, dayNumber, mealType, item }) =>
      toolRegistry.update_diet_plan({
        userId,
        planId,
        planName,
        action: "update",
        addFoodItem: {
          dayNumber: toNumber(dayNumber),
          mealType,
          item: {
            ...item,
            calories: toNumber(item.calories),
            protein: toNumber(item.protein),
            carbs: toNumber(item.carbs),
            fats: toNumber(item.fats),
          },
        },
      }),
  });
}

/**
 * Remove a single food item from a specific meal on a specific day.
 */
export function createRemoveFoodItemTool() {
  return new DynamicStructuredTool({
    name: "remove_diet_food_item",
    description:
      "Remove a specific food item from a meal on a specific day of an existing diet plan. " +
      "Example: remove rice from Dinner on Day 2.",
    schema: z.object({
      userId: z.string().describe("User ID (required)"),
      planId: z
        .string()
        .optional()
        .describe("MongoDB plan _id from the PRELOADED PLAN DATA. ALWAYS pass this when updating."),
      planName: z
        .string()
        .optional()
        .describe("Plan name fallback - only if planId is unavailable"),
      dayNumber: z.number().describe("1-based day index"),
      mealType: mealTypeEnum().describe("Meal to remove the item from"),
      foodName: z.string().describe("Name of the food item to remove (case-insensitive match)"),
    }),
    func: async ({ userId, planId, planName, dayNumber, mealType, foodName }) =>
      toolRegistry.update_diet_plan({
        userId,
        planId,
        planName,
        action: "update",
        removeFoodItem: {
          dayNumber: toNumber(dayNumber),
          mealType,
          foodName,
        },
      }),
  });
}
