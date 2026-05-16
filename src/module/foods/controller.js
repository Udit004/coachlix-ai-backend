// Foods controller - request/response handling
import { foodsService } from "./foodsService.js";

const verifyUserToken = async (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { statusCode: 401, message: "Invalid authorization header" };
  }

  const token = authHeader.substring(7);
  return { uid: "user-id-from-token" };
};

const wrap = (handler) => async (request, reply) => {
  try {
    const user = await verifyUserToken(request.headers.authorization);
    request.user = user;

    const result = await handler(request, reply);

    if (result?.statusCode) {
      return reply.code(result.statusCode).send(result);
    }

    return result;
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Internal server error";

    console.error(`[Foods Controller] Error:`, error);

    return reply
      .code(statusCode)
      .send({ success: false, message, error: error.toString() });
  }
};

export const createFoodsController = () => ({
  /**
   * GET /foods/popular - Get popular foods
   */
  getPopularFoods: wrap(async (request) => {
    try {
      const { category } = request.query;
      const result = await foodsService.getPopularFoods(category);

      return {
        success: true,
        foods: result.foods,
        cached: result.cached,
      };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error fetching popular foods",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /foods/search - Search foods
   */
  searchFoods: wrap(async (request) => {
    try {
      const { q, category } = request.query;

      if (!q) {
        return {
          statusCode: 400,
          success: false,
          message: "Search query is required",
        };
      }

      const result = await foodsService.searchFoods(q, category);

      return { success: true, ...result };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error searching foods",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /foods/:name - Get food details
   */
  getFoodDetails: wrap(async (request) => {
    try {
      const { name } = request.params;

      if (!name) {
        return {
          statusCode: 400,
          success: false,
          message: "Food name is required",
        };
      }

      const food = await foodsService.getFoodDetails(name);

      if (!food) {
        return {
          statusCode: 404,
          success: false,
          message: "Food not found",
        };
      }

      return { success: true, food };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error fetching food details",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /foods/category/:category - Get foods by category
   */
  getFoodsByCategory: wrap(async (request) => {
    try {
      const { category } = request.params;

      if (!category) {
        return {
          statusCode: 400,
          success: false,
          message: "Category is required",
        };
      }

      const foods = await foodsService.getFoodsByCategory(category);

      return { success: true, foods };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error fetching foods by category",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /foods/nutrition/:name - Get nutrition info
   */
  getNutritionInfo: wrap(async (request) => {
    try {
      const { name } = request.params;
      const { servingSize } = request.query;

      if (!name) {
        return {
          statusCode: 400,
          success: false,
          message: "Food name is required",
        };
      }

      const nutrition = await foodsService.getNutritionInfo(
        name,
        parseInt(servingSize) || 1
      );

      if (!nutrition) {
        return {
          statusCode: 404,
          success: false,
          message: "Food not found",
        };
      }

      return { success: true, nutrition };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error fetching nutrition info",
        error: error.toString(),
      };
    }
  }),
});
