// Exercises routes - endpoint definitions
import { createExercisesController } from "./controller.js";

export const registerExercisesModule = async (fastify, opts) => {
  const controller = createExercisesController();

  // GET /exercises - Search exercises
  fastify.get("/", controller.searchExercises);

  // POST /exercises/ai-search - Generate with AI
  fastify.post("/ai-search", controller.generateWithAI);

  // GET /exercises/suggest - Suggest exercises
  fastify.get("/suggest", controller.suggestExercises);

  // GET /exercises/:id - Get details
  fastify.get("/:id", controller.getExerciseDetails);
};
