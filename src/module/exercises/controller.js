// Exercises controller - request/response handling
import { exercisesService } from "./exercisesService.js";

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

    console.error(`[Exercises Controller] Error:`, error);

    return reply
      .code(statusCode)
      .send({ success: false, message, error: error.toString() });
  }
};

export const createExercisesController = () => ({
  /**
   * GET /exercises - Search and filter exercises
   */
  searchExercises: wrap(async (request) => {
    try {
      const result = await exercisesService.searchExercises(request.query);
      return { success: true, ...result };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error searching exercises",
        error: error.toString(),
      };
    }
  }),

  /**
   * POST /exercises/ai-search - Generate exercise info with AI
   */
  generateWithAI: wrap(async (request) => {
    const { exerciseName } = request.body;

    if (!exerciseName || exerciseName.trim() === "") {
      return {
        statusCode: 400,
        success: false,
        message: "Exercise name is required",
      };
    }

    try {
      const exerciseInfo = await exercisesService.generateExerciseWithAI(
        exerciseName
      );

      return { success: true, exercise: exerciseInfo };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error generating exercise with AI",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /exercises/suggest - Suggest exercises from external API
   */
  suggestExercises: wrap(async (request) => {
    const { q } = request.query;

    try {
      const result = await exercisesService.suggestExercises(q);
      return result;
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error suggesting exercises",
        error: error.toString(),
      };
    }
  }),

  /**
   * GET /exercises/:id - Get exercise details
   */
  getExerciseDetails: wrap(async (request) => {
    const { id } = request.params;

    try {
      const exercise = await exercisesService.getExerciseDetails(id);

      if (!exercise) {
        return {
          statusCode: 404,
          success: false,
          message: "Exercise not found",
        };
      }

      return { success: true, exercise };
    } catch (error) {
      throw {
        statusCode: 500,
        message: "Error fetching exercise details",
        error: error.toString(),
      };
    }
  }),
});
