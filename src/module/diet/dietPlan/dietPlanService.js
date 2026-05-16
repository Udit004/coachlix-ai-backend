import DietPlan from '../../../models/DietPlan.js';
import User from '../../../models/User.js';
import { getCacheValue, setCacheValue, findCacheKeys, deleteCacheKey } from '../../../shared/cache.js';
import { NotificationService } from '../services/notificationService.js';

const CACHE_TTL = {
  PLAN_LIST: 300,
  PLAN_DETAIL: 1800
};

const ALLOWED_MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Pre-Workout', 'Post-Workout'];

function normalizeGoal(goal) {
  if (!goal) return 'Maintenance';

  const normalized = String(goal).toLowerCase().trim();
  if (normalized === 'weight loss' || normalized === 'weight_loss') return 'Weight Loss';
  if (normalized === 'muscle gain' || normalized === 'muscle_gain') return 'Muscle Gain';
  if (normalized === 'maintenance' || normalized === 'maintain weight') return 'Maintenance';
  if (normalized === 'cutting') return 'Cutting';
  if (normalized === 'bulking') return 'Bulking';
  if (normalized === 'general health' || normalized === 'general_health') return 'General Health';
  return 'Maintenance';
}

function getMealTemplate(goal, dietaryPreference) {
  const isVegetarian = ['vegetarian', 'vegan', 'eggetarian'].includes(String(dietaryPreference || '').toLowerCase());
  const protein = isVegetarian ? 'paneer' : 'chicken';

  return {
    breakfast: [
      { name: 'Oats', calories: 180, protein: 6, carbs: 32, fats: 3, quantity: '1 bowl' },
      { name: 'Greek Yogurt', calories: 100, protein: 10, carbs: 6, fats: 2, quantity: '1 cup' }
    ],
    lunch: [
      { name: `${protein} Rice Bowl`, calories: 420, protein: 32, carbs: 42, fats: 12, quantity: '1 plate' }
    ],
    dinner: [
      { name: isVegetarian ? 'Lentil Curry' : 'Salmon Fillet', calories: isVegetarian ? 320 : 360, protein: isVegetarian ? 20 : 34, carbs: isVegetarian ? 28 : 8, fats: isVegetarian ? 10 : 18, quantity: '1 serving' }
    ],
    snacks: [
      { name: 'Mixed Nuts', calories: 160, protein: 5, carbs: 7, fats: 13, quantity: '1 handful' },
      { name: 'Banana', calories: 90, protein: 1, carbs: 23, fats: 0, quantity: '1 medium' }
    ]
  };
}

function buildMeal(type, items) {
  return {
    type,
    items: items.map((item) => ({
      name: item.name,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fats: item.fats,
      quantity: item.quantity,
      notes: item.notes || ''
    }))
  };
}

function buildGeneratedDays(duration, goal, dietaryPreference) {
  const template = getMealTemplate(goal, dietaryPreference);
  const days = [];

  for (let dayNumber = 1; dayNumber <= duration; dayNumber += 1) {
    days.push({
      dayNumber,
      meals: [
        buildMeal('Breakfast', template.breakfast),
        buildMeal('Lunch', template.lunch),
        buildMeal('Dinner', template.dinner),
        buildMeal('Snacks', template.snacks)
      ],
      waterIntake: 2.5,
      notes: `Day ${dayNumber} - stay consistent with your nutrition.`
    });
  }

  return days;
}

async function invalidateDietPlanCache(userId, planId = null) {
  try {
    const listKeys = await findCacheKeys(`user:diet-plans-list:${userId}:*`);
    if (listKeys.length > 0) {
      await Promise.all(listKeys.map((key) => deleteCacheKey(key)));
    }

    if (planId) {
      await deleteCacheKey(`user:diet-plan:${userId}:${planId}`);
    }
  } catch (error) {
    console.error('Diet cache invalidation failed:', error);
  }
}

async function updateRecentActivity(userId, activity) {
  await User.findOneAndUpdate(
    { firebaseUid: userId },
    {
      $push: {
        recentActivities: {
          $each: [activity],
          $slice: -10
        }
      }
    }
  );
}

async function sendPlanNotification(userId, title, body, data = {}) {
  const user = await User.findOne({ firebaseUid: userId });
  if (!user?.pushToken) {
    return false;
  }

  NotificationService.sendCustomNotification(user.pushToken, title, body, data).catch((error) => {
    console.error('Diet notification failed:', error);
  });

  return true;
}

async function getUserPlanOrError(userId, planId) {
  const plan = await DietPlan.findOne({ _id: planId, userId });
  if (!plan) {
    const error = new Error('Diet plan not found or unauthorized');
    error.statusCode = 404;
    throw error;
  }

  return plan;
}

function getMacrosFromTotals(days) {
  const totals = days.reduce(
    (acc, day) => ({
      calories: acc.calories + (day.totalCalories || 0),
      protein: acc.protein + (day.totalProtein || 0),
      carbs: acc.carbs + (day.totalCarbs || 0),
      fats: acc.fats + (day.totalFats || 0)
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  return {
    dailyAverages: days.length > 0
      ? {
          calories: Math.round(totals.calories / days.length),
          protein: Math.round(totals.protein / days.length),
          carbs: Math.round(totals.carbs / days.length),
          fats: Math.round(totals.fats / days.length)
        }
      : {
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0
        }
  };
}

export async function listDietPlans(userId, query = {}) {
  // Add summary flag to cache key for separate caching
  const cacheKey = `user:diet-plans-list:${userId}:${query.active || 'all'}:${query.goal || 'all'}:${query.sort || 'default'}:${query.summary ? 'summary' : 'full'}`;

  const cached = await getCacheValue(cacheKey);
  if (cached) {
    return {
      success: true,
      plans: cached,
      count: Array.isArray(cached) ? cached.length : 0,
      cached: true
    };
  }

  const mongoQuery = { userId };
  if (query.active === 'true') mongoQuery.isActive = true;
  if (query.goal) mongoQuery.goal = query.goal;

  let sortObj = { createdAt: -1 };
  switch (query.sort) {
    case '-createdAt':
    case 'newest':
      sortObj = { createdAt: -1 };
      break;
    case 'createdAt':
    case 'oldest':
      sortObj = { createdAt: 1 };
      break;
    case '-updatedAt':
    case 'updated':
      sortObj = { updatedAt: -1 };
      break;
  }

  let planQuery = DietPlan.find(mongoQuery).sort(sortObj);

  // If summary flag is true, exclude days array to reduce payload size
  if (query.summary === 'true' || query.summary === true) {
    planQuery = planQuery.select('-days');
  }

  if (query.limit) {
    planQuery = planQuery.limit(Number.parseInt(query.limit, 10));
  }

  const plans = await planQuery.exec();
  await setCacheValue(cacheKey, CACHE_TTL.PLAN_LIST, plans);

  return {
    success: true,
    plans,
    count: plans.length
  };
}

export async function getDietPlan(userId, planId) {
  const cacheKey = `user:diet-plan:${userId}:${planId}`;
  const cached = await getCacheValue(cacheKey);
  if (cached) {
    return {
      success: true,
      plan: cached,
      cached: true
    };
  }

  const plan = await getUserPlanOrError(userId, planId);
  await setCacheValue(cacheKey, CACHE_TTL.PLAN_DETAIL, plan);

  return {
    success: true,
    plan
  };
}

export async function createDietPlan(userId, body) {
  const {
    name,
    goal,
    targetCalories,
    targetProtein,
    targetCarbs,
    targetFats,
    duration
  } = body;

  if (!name || !goal || !targetCalories || !duration) {
    const error = new Error('Missing required fields: name, goal, targetCalories, duration');
    error.statusCode = 400;
    throw error;
  }

  const days = body.days || [];
  if (days.length !== duration) {
    const error = new Error(`The number of days (${days.length}) does not match the duration (${duration}).`);
    error.statusCode = 400;
    throw error;
  }

  if (body.isActive === true) {
    await DietPlan.updateMany({ userId }, { $set: { isActive: false } });
  }

  const plan = new DietPlan({
    userId,
    name: String(name).trim(),
    description: body.description?.trim(),
    goal,
    targetCalories,
    targetProtein: targetProtein || 0,
    targetCarbs: targetCarbs || 0,
    targetFats: targetFats || 0,
    duration,
    days,
    isActive: body.isActive === true,
    difficulty: body.difficulty || 'Beginner',
    tags: body.tags || [],
    createdBy: body.createdBy || 'user'
  });

  const savedPlan = await plan.save();

  await invalidateDietPlanCache(userId);

  const notificationSent = await sendPlanNotification(
    userId,
    'New Diet Plan Created! 🥗',
    `Your "${savedPlan.name}" diet plan is ready to help you reach your ${String(goal).toLowerCase()} goal!`,
    {
      type: 'diet_plan_created',
      planId: savedPlan._id.toString(),
      planName: savedPlan.name,
      goal
    }
  );

  if (notificationSent) {
    await updateRecentActivity(userId, {
      type: 'diet_plan_created',
      description: `Created new diet plan: ${savedPlan.name}`,
      timestamp: new Date(),
      details: {
        planName: savedPlan.name,
        goal,
        targetCalories
      }
    });
  }

  return {
    success: true,
    plan: savedPlan,
    message: 'Diet plan created successfully',
    notification: {
      sent: notificationSent
    }
  };
}

export async function updateDietPlan(userId, planId, updateData) {
  if (updateData.duration && updateData.days && updateData.duration !== updateData.days.length) {
    const error = new Error('Duration and days array length must match');
    error.statusCode = 400;
    throw error;
  }

  if (updateData.duration && !updateData.days) {
    const error = new Error('If updating duration, days array must be provided');
    error.statusCode = 400;
    throw error;
  }

  if (!updateData.duration && updateData.days) {
    const error = new Error('If updating days array, duration must be provided');
    error.statusCode = 400;
    throw error;
  }

  const plan = await getUserPlanOrError(userId, planId);
  Object.assign(plan, {
    ...updateData,
    updatedAt: new Date()
  });

  const updatedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);

  const notificationSent = await sendPlanNotification(
    userId,
    'Diet Plan Updated! 📝',
    `Your "${updatedPlan.name}" diet plan has been successfully updated.`,
    {
      type: 'diet_plan_updated',
      planId: updatedPlan._id.toString(),
      planName: updatedPlan.name,
      goal: updatedPlan.goal
    }
  );

  if (notificationSent) {
    await updateRecentActivity(userId, {
      type: 'diet_plan_updated',
      description: `Updated diet plan: ${updatedPlan.name}`,
      timestamp: new Date(),
      details: {
        planName: updatedPlan.name,
        goal: updatedPlan.goal
      }
    });
  }

  return {
    success: true,
    plan: updatedPlan,
    message: 'Diet plan updated successfully',
    notification: {
      sent: notificationSent
    }
  };
}

export async function deleteDietPlan(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);
  await DietPlan.findOneAndDelete({ _id: planId, userId });
  await invalidateDietPlanCache(userId, planId);

  const notificationSent = await sendPlanNotification(
    userId,
    'Diet Plan Deleted 🗑️',
    `Your "${plan.name}" diet plan has been deleted.`,
    {
      type: 'diet_plan_deleted',
      planName: plan.name,
      goal: plan.goal
    }
  );

  if (notificationSent) {
    await updateRecentActivity(userId, {
      type: 'diet_plan_deleted',
      description: `Deleted diet plan: ${plan.name}`,
      timestamp: new Date(),
      details: {
        planName: plan.name,
        goal: plan.goal
      }
    });
  }

  return {
    success: true,
    message: 'Diet plan deleted successfully',
    notification: {
      sent: notificationSent
    }
  };
}

export async function updatePlanByBody(userId, body) {
  const { planId, ...updateData } = body;
  if (!planId) {
    const error = new Error('Plan ID is required');
    error.statusCode = 400;
    throw error;
  }

  return updateDietPlan(userId, planId, updateData);
}

export async function deletePlanByQuery(userId, planId) {
  if (!planId) {
    const error = new Error('Plan ID is required');
    error.statusCode = 400;
    throw error;
  }

  return deleteDietPlan(userId, planId);
}

export async function setPlanActiveState(userId, planId, isActive) {
  const plan = await getUserPlanOrError(userId, planId);

  if (isActive) {
    await DietPlan.updateMany(
      { userId, _id: { $ne: planId } },
      { $set: { isActive: false } }
    );
    plan.isActive = true;
  } else {
    plan.isActive = false;
  }

  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);

  await updateRecentActivity(userId, {
    type: isActive ? 'diet_plan_activated' : 'diet_plan_deactivated',
    description: `${isActive ? 'Activated' : 'Deactivated'} diet plan: ${savedPlan.name}`,
    timestamp: new Date(),
    details: {
      planName: savedPlan.name,
      goal: savedPlan.goal
    }
  });

  return {
    success: true,
    plan: savedPlan,
    message: isActive ? 'Diet plan activated successfully' : 'Diet plan deactivated successfully'
  };
}

export async function cloneDietPlan(userId, planId, name) {
  if (!name) {
    const error = new Error('Name is required for cloned plan');
    error.statusCode = 400;
    throw error;
  }

  const originalPlan = await getUserPlanOrError(userId, planId);

  const clonedPlan = new DietPlan({
    userId,
    name: String(name).trim(),
    description: originalPlan.description ? `${originalPlan.description} (Cloned)` : null,
    goal: originalPlan.goal,
    targetCalories: originalPlan.targetCalories,
    targetProtein: originalPlan.targetProtein,
    targetCarbs: originalPlan.targetCarbs,
    targetFats: originalPlan.targetFats,
    duration: originalPlan.duration,
    days: originalPlan.days.map((day) => ({
      ...day.toObject(),
      _id: undefined
    })),
    isActive: false,
    difficulty: originalPlan.difficulty,
    tags: [...originalPlan.tags],
    createdBy: 'user'
  });

  const savedClone = await clonedPlan.save();
  await invalidateDietPlanCache(userId, savedClone._id.toString());

  const notificationSent = await sendPlanNotification(
    userId,
    'Diet Plan Cloned ✅',
    `Your plan "${originalPlan.name}" was cloned as "${savedClone.name}"`,
    {
      type: 'diet_plan_cloned',
      planId: savedClone._id.toString(),
      planName: savedClone.name
    }
  );

  if (notificationSent) {
    await updateRecentActivity(userId, {
      type: 'diet_plan_cloned',
      description: `Cloned diet plan: ${originalPlan.name}`,
      timestamp: new Date(),
      details: {
        originalPlanName: originalPlan.name,
        clonedPlanName: savedClone.name
      }
    });
  }

  return savedClone;
}

export async function getNutritionSummary(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);
  const summary = {
    totalDays: plan.days.length,
    averageCalories: plan.getAverageCalories(),
    totalMeals: plan.getTotalMeals(),
    targets: {
      calories: plan.targetCalories,
      protein: plan.targetProtein,
      carbs: plan.targetCarbs,
      fats: plan.targetFats
    },
    dailyAverages: {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0
    }
  };

  if (plan.days.length > 0) {
    summary.dailyAverages = getMacrosFromTotals(plan.days).dailyAverages;
  }

  return summary;
}

export async function addDay(userId, planId, dayData) {
  if (!dayData.dayNumber) {
    const error = new Error('dayNumber is required');
    error.statusCode = 400;
    throw error;
  }

  const plan = await getUserPlanOrError(userId, planId);
  if (plan.days.find((day) => day.dayNumber === dayData.dayNumber)) {
    const error = new Error('Day already exists');
    error.statusCode = 400;
    throw error;
  }

  plan.days.push({
    dayNumber: dayData.dayNumber,
    meals: dayData.meals || [],
    notes: dayData.notes,
    waterIntake: dayData.waterIntake || 0
  });

  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function updateDay(userId, planId, dayNumber, dayData) {
  const plan = await getUserPlanOrError(userId, planId);
  const dayIndex = plan.days.findIndex((day) => day.dayNumber === dayNumber);

  if (dayIndex === -1) {
    const error = new Error('Day not found');
    error.statusCode = 404;
    throw error;
  }

  Object.assign(plan.days[dayIndex], dayData);
  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function addMeal(userId, planId, dayNumber, mealData) {
  if (!mealData.type) {
    const error = new Error('Meal type is required');
    error.statusCode = 400;
    throw error;
  }

  if (!ALLOWED_MEAL_TYPES.includes(mealData.type)) {
    const error = new Error('Invalid meal type');
    error.statusCode = 400;
    throw error;
  }

  const plan = await getUserPlanOrError(userId, planId);
  const day = plan.days.find((item) => item.dayNumber === dayNumber);

  if (!day) {
    const error = new Error('Day not found');
    error.statusCode = 404;
    throw error;
  }

  day.meals.push({
    type: mealData.type,
    items: mealData.items || []
  });

  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function addFoodItem(userId, planId, dayNumber, mealType, foodItem) {
  if (!foodItem.name || typeof foodItem.calories !== 'number') {
    const error = new Error('Food item must have name and calories');
    error.statusCode = 400;
    throw error;
  }

  const plan = await getUserPlanOrError(userId, planId);
  const day = plan.days.find((item) => item.dayNumber === dayNumber);
  if (!day) {
    const error = new Error('Day not found');
    error.statusCode = 404;
    throw error;
  }

  const meal = day.meals.find((item) => item.type === mealType);
  if (!meal) {
    const error = new Error('Meal not found');
    error.statusCode = 404;
    throw error;
  }

  meal.items.push({
    name: foodItem.name.trim(),
    calories: foodItem.calories,
    protein: foodItem.protein || 0,
    carbs: foodItem.carbs || 0,
    fats: foodItem.fats || 0,
    quantity: foodItem.quantity || '1 serving',
    notes: foodItem.notes?.trim()
  });

  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function updateFoodItem(userId, planId, dayNumber, mealType, itemIndex, foodItem) {
  const plan = await getUserPlanOrError(userId, planId);
  const day = plan.days.find((item) => item.dayNumber === dayNumber);
  if (!day) {
    const error = new Error('Day not found');
    error.statusCode = 404;
    throw error;
  }

  const meal = day.meals.find((item) => item.type === mealType);
  if (!meal) {
    const error = new Error('Meal not found');
    error.statusCode = 404;
    throw error;
  }

  if (itemIndex < 0 || itemIndex >= meal.items.length) {
    const error = new Error('Food item not found');
    error.statusCode = 404;
    throw error;
  }

  meal.items[itemIndex] = {
    ...(typeof meal.items[itemIndex].toObject === 'function' ? meal.items[itemIndex].toObject() : meal.items[itemIndex]),
    ...foodItem,
    name: String(foodItem.name || meal.items[itemIndex].name).trim()
  };

  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function deleteFoodItem(userId, planId, dayNumber, mealType, itemIndex) {
  const plan = await getUserPlanOrError(userId, planId);
  const day = plan.days.find((item) => item.dayNumber === dayNumber);
  if (!day) {
    const error = new Error('Day not found');
    error.statusCode = 404;
    throw error;
  }

  const meal = day.meals.find((item) => item.type === mealType);
  if (!meal) {
    const error = new Error('Meal not found');
    error.statusCode = 404;
    throw error;
  }

  if (itemIndex < 0 || itemIndex >= meal.items.length) {
    const error = new Error('Food item not found');
    error.statusCode = 404;
    throw error;
  }

  meal.items.splice(itemIndex, 1);
  plan.markModified('days');
  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, planId);
  return savedPlan.toObject();
}

export async function generateAiDietPlan(userId, preferences) {
  const user = await User.findOne({ firebaseUid: userId }).lean();
  if (!user) {
    const error = new Error('User profile not found. Please complete your profile first.');
    error.statusCode = 404;
    throw error;
  }

  const goal = normalizeGoal(preferences.goal || user.fitnessGoal);
  const userWeight = user.weight || 70;
  const userHeight = user.height || 170;
  const userAge = user.age || 25;
  const userGender = user.gender || 'male';

  let calories = preferences.targetCalories;
  if (!calories) {
    let bmr;
    if (String(userGender).toLowerCase() === 'male') {
      bmr = 10 * userWeight + 6.25 * userHeight - 5 * userAge + 5;
    } else {
      bmr = 10 * userWeight + 6.25 * userHeight - 5 * userAge - 161;
    }

    const maintenanceCalories = Math.round(bmr * 1.55);
    if (goal.includes('Weight Loss') || goal.includes('Cutting')) {
      calories = Math.round(maintenanceCalories * 0.8);
    } else if (goal.includes('Muscle Gain') || goal.includes('Bulking')) {
      calories = Math.round(maintenanceCalories * 1.15);
    } else {
      calories = maintenanceCalories;
    }
  }

  let proteinTarget;
  let carbTarget;
  let fatTarget;

  if (goal.includes('Muscle Gain') || goal.includes('Bulking')) {
    proteinTarget = Math.round(userWeight * 2.2);
    fatTarget = Math.round((calories * 0.25) / 9);
    carbTarget = Math.round((calories - proteinTarget * 4 - fatTarget * 9) / 4);
  } else if (goal.includes('Weight Loss') || goal.includes('Cutting')) {
    proteinTarget = Math.round(userWeight * 2.0);
    fatTarget = Math.round((calories * 0.25) / 9);
    carbTarget = Math.round((calories - proteinTarget * 4 - fatTarget * 9) / 4);
  } else {
    proteinTarget = Math.round(userWeight * 1.6);
    fatTarget = Math.round((calories * 0.3) / 9);
    carbTarget = Math.round((calories - proteinTarget * 4 - fatTarget * 9) / 4);
  }

  const duration = preferences.duration || 7;
  const days = buildGeneratedDays(duration, goal, user.dietaryPreference);

  await DietPlan.updateMany({ userId, isActive: true }, { $set: { isActive: false } });

  const plan = new DietPlan({
    userId,
    name: preferences.planName || `${goal} Plan - ${new Date().toLocaleDateString()}`,
    description: `Personalized ${goal} diet plan with ${calories} daily calories`,
    goal,
    targetCalories: calories,
    targetProtein: proteinTarget,
    targetCarbs: carbTarget,
    targetFats: fatTarget,
    duration,
    days,
    isActive: true,
    difficulty: preferences.difficulty || user.experience || 'Beginner',
    tags: preferences.tags || [goal, `${calories}cal`],
    createdBy: 'ai'
  });

  const savedPlan = await plan.save();
  await invalidateDietPlanCache(userId, savedPlan._id.toString());

  await updateRecentActivity(userId, {
    type: 'diet_plan_created',
    description: `Created new diet plan: ${savedPlan.name}`,
    timestamp: new Date(),
    details: {
      planName: savedPlan.name,
      goal,
      targetCalories: calories
    }
  });

  return {
    success: true,
    plan: savedPlan,
    message: 'AI diet plan generated successfully'
  };
}