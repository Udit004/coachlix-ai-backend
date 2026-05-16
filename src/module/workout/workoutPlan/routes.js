import { createWorkoutPlanController } from './controller.js';

export async function registerWorkoutPlanRoutes(fastify) {
  const controller = createWorkoutPlanController();

  fastify.get('/', controller.listWorkoutPlans);
  fastify.post('/', controller.createWorkoutPlan);
  fastify.put('/', controller.updateWorkoutPlanByBody);
  fastify.delete('/', controller.deleteWorkoutPlanByQuery);
  fastify.post('/generate-ai', controller.generateAiWorkoutPlan);

  fastify.get('/:id', controller.getWorkoutPlan);
  fastify.put('/:id', controller.updateWorkoutPlan);
  fastify.delete('/:id', controller.deleteWorkoutPlan);

  fastify.post('/:id/activate', controller.activateWorkoutPlan);
  fastify.delete('/:id/activate', controller.deactivateWorkoutPlan);

  fastify.post('/:id/clone', controller.cloneWorkoutPlan);

  fastify.get('/:id/stats', controller.getWorkoutStats);

  fastify.get('/:id/progress', controller.getProgressHistory);
  fastify.post('/:id/progress', controller.addProgressEntry);
  fastify.put('/:id/progress/batch', controller.batchUpdateProgressEntries);
  fastify.get('/:id/progress/:progressId', controller.getProgressEntry);
  fastify.put('/:id/progress/:progressId', controller.updateProgressEntry);
  fastify.delete('/:id/progress/:progressId', controller.deleteProgressEntry);

  // Granular management routes
  fastify.post('/:id/weeks', controller.addWeek);
  fastify.put('/:id/weeks/:weekNumber', controller.updateWeek);
  fastify.delete('/:id/weeks/:weekNumber', controller.deleteWeek);

  fastify.post('/:id/weeks/:weekNumber/days/:dayNumber/workouts', controller.addWorkoutToDay);
  fastify.delete('/:id/weeks/:weekNumber/days/:dayNumber/workouts/:workoutIndex', controller.deleteWorkoutFromDay);
  fastify.delete('/:id/weeks/:weekNumber/days/:dayNumber', controller.clearDayWorkouts);

  // Exercise management (supports both direct and index-based workout access)
  fastify.get('/:id/weeks/:weekNumber/days/:dayNumber/workouts/:workoutIndex/exercises', controller.getWorkoutExercises);
  fastify.post('/:id/weeks/:weekNumber/days/:dayNumber/workouts/:workoutIndex/exercises', controller.addExercisesToWorkout);
  fastify.put('/:id/weeks/:weekNumber/days/:dayNumber/workouts/:workoutIndex/exercises', controller.updateWorkoutExercises);
  fastify.delete('/:id/weeks/:weekNumber/days/:dayNumber/workouts/:workoutIndex/exercises/:exerciseIndex', controller.deleteExerciseFromWorkout);

  // Support for /index/ prefix used by frontend for clarity
  fastify.get('/:id/weeks/:weekNumber/days/:dayNumber/workouts/index/:workoutIndex/exercises', controller.getWorkoutExercises);
  fastify.post('/:id/weeks/:weekNumber/days/:dayNumber/workouts/index/:workoutIndex/exercises', controller.addExercisesToWorkout);
  fastify.put('/:id/weeks/:weekNumber/days/:dayNumber/workouts/index/:workoutIndex/exercises', controller.updateWorkoutExercises);
  fastify.delete('/:id/weeks/:weekNumber/days/:dayNumber/workouts/index/:workoutIndex/exercises/:exerciseIndex', controller.deleteExerciseFromWorkout);
}
