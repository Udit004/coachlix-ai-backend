import WorkoutPlan from '../../models/WorkoutPlan.js';
import DietPlan from '../../models/DietPlan.js';

function toPlainObject(document) {
  if (!document) {
    return null;
  }

  return JSON.parse(JSON.stringify(document));
}

async function getPrimaryWorkoutPlan(userId) {
  const activePlan = await WorkoutPlan.findOne({ userId, isActive: true })
    .select('_id name startDate isActive weeks stats')
    .lean();

  if (activePlan) {
    return activePlan;
  }

  return WorkoutPlan.findOne({ userId })
    .sort({ createdAt: -1 })
    .select('_id name startDate isActive weeks stats')
    .lean();
}

async function getPrimaryDietPlan(userId) {
  const activePlan = await DietPlan.findOne({ userId, isActive: true })
    .select('_id name createdAt isActive targetCalories targetProtein targetCarbs targetFats days')
    .lean();

  if (activePlan) {
    return activePlan;
  }

  return DietPlan.findOne({ userId })
    .sort({ createdAt: -1 })
    .select('_id name createdAt isActive targetCalories targetProtein targetCarbs targetFats days')
    .lean();
}

export async function getDashboardOverview(userId) {
  const [workoutPlan, dietPlan] = await Promise.all([
    getPrimaryWorkoutPlan(userId),
    getPrimaryDietPlan(userId)
  ]);

  return {
    success: true,
    data: {
      workoutPlan: toPlainObject(workoutPlan),
      dietPlan: toPlainObject(dietPlan),
      workoutStats: toPlainObject(workoutPlan?.stats || null),
      nutritionStreak: 0
    }
  };
}