// Foods routes - endpoint definitions
import { createFoodsController } from "./controller.js";

export const registerFoodsModule = async (fastify, opts) => {
  const controller = createFoodsController();

  // GET /foods/popular - Get popular foods
  fastify.get("/popular", controller.getPopularFoods);

  // GET /foods/search - Search foods
  fastify.get("/search", controller.searchFoods);

  // GET /foods/category/:category - Get by category
  fastify.get("/category/:category", controller.getFoodsByCategory);

  // GET /foods/nutrition/:name - Get nutrition info
  fastify.get("/nutrition/:name", controller.getNutritionInfo);

  // GET /foods/:name - Get details
  fastify.get("/:name", controller.getFoodDetails);
};
