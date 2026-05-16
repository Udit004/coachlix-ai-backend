// Foods service - handles food search and popular foods
import { redis } from "../../shared/cache.js";

// Popular foods database
const POPULAR_FOODS = [
  {
    name: "Grilled Chicken Breast",
    calories: 165,
    protein: 31,
    carbohydrates: 0,
    fat: 3.6,
    serving_size: "100g",
    category: "protein",
  },
  {
    name: "Brown Rice",
    calories: 111,
    protein: 2.6,
    carbohydrates: 23,
    fat: 0.9,
    serving_size: "100g cooked",
    category: "carbohydrate",
  },
  {
    name: "Whole Wheat Bread",
    calories: 247,
    protein: 13,
    carbohydrates: 41,
    fat: 4.2,
    serving_size: "2 slices",
    category: "carbohydrate",
  },
  {
    name: "Eggs",
    calories: 155,
    protein: 13,
    carbohydrates: 1.1,
    fat: 11,
    serving_size: "2 large eggs",
    category: "protein",
  },
  {
    name: "Salmon Fillet",
    calories: 206,
    protein: 22,
    carbohydrates: 0,
    fat: 12,
    serving_size: "100g",
    category: "protein",
  },
  {
    name: "Sweet Potato",
    calories: 86,
    protein: 1.6,
    carbohydrates: 20,
    fat: 0.1,
    serving_size: "1 medium",
    category: "carbohydrate",
  },
  {
    name: "Greek Yogurt",
    calories: 59,
    protein: 10,
    carbohydrates: 3.6,
    fat: 0.4,
    serving_size: "100g",
    category: "protein",
  },
  {
    name: "Avocado",
    calories: 160,
    protein: 2,
    carbohydrates: 8.5,
    fat: 14.7,
    serving_size: "1/2 medium",
    category: "fat",
  },
  {
    name: "Oatmeal",
    calories: 124,
    protein: 5,
    carbohydrates: 21,
    fat: 2.5,
    serving_size: "100g cooked",
    category: "carbohydrate",
  },
  {
    name: "Broccoli",
    calories: 34,
    protein: 2.8,
    carbohydrates: 7,
    fat: 0.4,
    serving_size: "100g",
    category: "vegetable",
  },
  {
    name: "Almonds",
    calories: 579,
    protein: 21,
    carbohydrates: 22,
    fat: 50,
    serving_size: "100g",
    category: "fat",
  },
  {
    name: "Banana",
    calories: 89,
    protein: 1.1,
    carbohydrates: 23,
    fat: 0.3,
    serving_size: "1 medium",
    category: "carbohydrate",
  },
  {
    name: "Spinach",
    calories: 23,
    protein: 2.7,
    carbohydrates: 3.6,
    fat: 0.4,
    serving_size: "100g",
    category: "vegetable",
  },
  {
    name: "Beef Steak",
    calories: 250,
    protein: 26,
    carbohydrates: 0,
    fat: 15,
    serving_size: "100g",
    category: "protein",
  },
  {
    name: "Quinoa",
    calories: 120,
    protein: 4.4,
    carbohydrates: 21,
    fat: 1.9,
    serving_size: "100g cooked",
    category: "carbohydrate",
  },
];

export const foodsService = {
  /**
   * Get popular foods list (with caching)
   */
  async getPopularFoods(category = null) {
    try {
      const cacheKey = category
        ? `popular-foods:${category}`
        : "popular-foods:all";

      // Try cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        const foods =
          typeof cached === "string" ? JSON.parse(cached) : cached;
        return { foods, cached: true };
      }

      // Filter by category if provided
      let foods = POPULAR_FOODS;
      if (category) {
        foods = foods.filter((f) =>
          f.category.toLowerCase().includes(category.toLowerCase())
        );
      }

      // Cache for 24 hours
      await redis.set(cacheKey, JSON.stringify(foods), "EX", 86400);

      return { foods, cached: false };
    } catch (error) {
      console.error("[Foods Service] Error getting popular foods:", error);
      throw error;
    }
  },

  /**
   * Search foods by name or category
   */
  async searchFoods(query, category = null) {
    try {
      if (!query || query.trim().length < 2) {
        return {
          foods: [],
          query,
          category,
          totalResults: 0,
        };
      }

      const lowerQuery = query.toLowerCase();

      // Search across POPULAR_FOODS
      let results = POPULAR_FOODS.filter(
        (food) =>
          food.name.toLowerCase().includes(lowerQuery) ||
          food.category.toLowerCase().includes(lowerQuery)
      );

      // Filter by category if provided
      if (category) {
        results = results.filter((f) =>
          f.category.toLowerCase().includes(category.toLowerCase())
        );
      }

      // Sort by relevance (name match first)
      results.sort((a, b) => {
        const aNameMatch = a.name
          .toLowerCase()
          .startsWith(lowerQuery);
        const bNameMatch = b.name
          .toLowerCase()
          .startsWith(lowerQuery);

        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        return 0;
      });

      return {
        foods: results.slice(0, 50),
        query,
        category,
        totalResults: results.length,
      };
    } catch (error) {
      console.error("[Foods Service] Error searching foods:", error);
      throw error;
    }
  },

  /**
   * Get detailed food info
   */
  async getFoodDetails(foodName) {
    try {
      const cacheKey = `food:${foodName.toLowerCase()}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return typeof cached === "string" ? JSON.parse(cached) : cached;
      }

      const food = POPULAR_FOODS.find(
        (f) => f.name.toLowerCase() === foodName.toLowerCase()
      );

      if (food) {
        await redis.set(cacheKey, JSON.stringify(food), "EX", 86400);
      }

      return food;
    } catch (error) {
      console.error("[Foods Service] Error getting food details:", error);
      throw error;
    }
  },

  /**
   * Get foods by category
   */
  async getFoodsByCategory(category) {
    try {
      const cacheKey = `foods-category:${category.toLowerCase()}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return typeof cached === "string" ? JSON.parse(cached) : cached;
      }

      const foods = POPULAR_FOODS.filter(
        (f) => f.category.toLowerCase() === category.toLowerCase()
      );

      await redis.set(cacheKey, JSON.stringify(foods), "EX", 86400);

      return foods;
    } catch (error) {
      console.error(
        "[Foods Service] Error getting foods by category:",
        error
      );
      throw error;
    }
  },

  /**
   * Get nutrition info
   */
  async getNutritionInfo(foodName, servingSize = 1) {
    try {
      const food = await this.getFoodDetails(foodName);

      if (!food) {
        return null;
      }

      return {
        name: food.name,
        serving_size: food.serving_size,
        servings: servingSize,
        calories: food.calories * servingSize,
        protein: food.protein * servingSize,
        carbohydrates: food.carbohydrates * servingSize,
        fat: food.fat * servingSize,
        category: food.category,
      };
    } catch (error) {
      console.error("[Foods Service] Error getting nutrition info:", error);
      throw error;
    }
  },
};
