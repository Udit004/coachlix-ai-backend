import WorkoutPlan from '../../../models/WorkoutPlan.js';
import User from '../../../models/User.js';
import { getCacheValue, setCacheValue, findCacheKeys, deleteCacheKey } from '../../../shared/cache.js';

const CACHE_TTL = {
  PLAN_LIST: 300,
  PLAN_DETAIL: 1800
};

function normalizeGoal(goal) {
  if (!goal) return 'Muscle Gain';

  const normalized = String(goal).toLowerCase().trim();
  if (normalized === 'weight loss' || normalized === 'weight_loss') return 'Weight Loss';
  if (normalized === 'muscle gain' || normalized === 'muscle_gain') return 'Muscle Gain';
  if (normalized === 'strength' || normalized === 'strength gain') return 'Strength';
  if (normalized === 'endurance') return 'Endurance';
  if (normalized === 'general fitness' || normalized === 'general_fitness') return 'General Fitness';
  return 'Muscle Gain';
}

async function invalidateWorkoutPlanCache(userId, planId = null) {
  try {
    const listKeys = await findCacheKeys(`user:workout-plans-list:${userId}:*`);
    if (listKeys.length > 0) {
      await Promise.all(listKeys.map((key) => deleteCacheKey(key)));
    }

    if (planId) {
      await deleteCacheKey(`user:workout-plan:${userId}:${planId}`);
    }
  } catch (error) {
    console.error('Workout plan cache invalidation failed:', error);
  }
}

async function getUserPlanOrError(userId, planId) {
  const plan = await WorkoutPlan.findOne({ _id: planId, userId });
  if (!plan) {
    const error = new Error('Workout plan not found or unauthorized');
    error.statusCode = 404;
    throw error;
  }

  return plan;
}

function calculatePlanStats(plan) {
  if (!plan.weeks || plan.weeks.length === 0) {
    return {
      totalWorkoutsCount: 0,
      workoutFrequency: 0
    };
  }

  let totalWorkouts = 0;
  plan.weeks.forEach((week) => {
    if (week.days) {
      week.days.forEach((day) => {
        if (!day.isRestDay && day.workouts && day.workouts.length > 0) {
          totalWorkouts++;
        }
      });
    }
  });

  const durationWeeks = plan.duration || plan.weeks.length || 1;
  const frequency = Math.round((totalWorkouts / durationWeeks) * 10) / 10;

  return {
    totalWorkoutsCount: totalWorkouts,
    workoutFrequency: frequency
  };
}

export async function listWorkoutPlans(userId, query = {}) {
  const cacheKey = `user:workout-plans-list:${userId}:${query.active || 'all'}:${query.goal || 'all'}:${query.difficulty || 'all'}:${query.sort || 'default'}`;

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
  if (query.difficulty) mongoQuery.difficulty = query.difficulty;

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

  let planQuery = WorkoutPlan.find(mongoQuery).sort(sortObj).select('-weeks');
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

export async function getWorkoutPlan(userId, planId) {
  const cacheKey = `user:workout-plan:${userId}:${planId}`;
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

export async function createWorkoutPlan(userId, body) {
  const {
    name,
    goal,
    difficulty,
    duration,
    weeks,
    targetMuscleGroups,
    equipment
  } = body;

  if (!name || !goal || !duration) {
    const error = new Error('Missing required fields: name, goal, duration');
    error.statusCode = 400;
    throw error;
  }

  if (body.isActive === true) {
    await WorkoutPlan.updateMany({ userId }, { $set: { isActive: false } });
  }

  const plan = new WorkoutPlan({
    userId,
    name: String(name).trim(),
    description: body.description?.trim(),
    goal: normalizeGoal(goal),
    difficulty: difficulty || 'Beginner',
    duration,
    weeks: weeks || [],
    targetMuscleGroups: targetMuscleGroups || [],
    equipment: equipment || [],
    isActive: body.isActive === true,
    tags: body.tags || [],
    createdBy: body.createdBy || 'user'
  });

  // Calculate and set stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  const savedPlan = await plan.save();

  await invalidateWorkoutPlanCache(userId);

  return {
    success: true,
    plan: savedPlan,
    message: 'Workout plan created successfully'
  };
}

export async function updateWorkoutPlan(userId, planId, updateData) {
  const plan = await getUserPlanOrError(userId, planId);
  Object.assign(plan, {
    ...updateData,
    updatedAt: new Date()
  });

  // Re-calculate stats if weeks or duration changed
  if (updateData.weeks || updateData.duration) {
    const stats = calculatePlanStats(plan);
    plan.totalWorkoutsCount = stats.totalWorkoutsCount;
    plan.workoutFrequency = stats.workoutFrequency;
  }

  const updatedPlan = await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    plan: updatedPlan,
    message: 'Workout plan updated successfully'
  };
}

export async function updatePlanByBody(userId, body) {
  if (!body || !body.planId) {
    const error = new Error('planId is required');
    error.statusCode = 400;
    throw error;
  }

  const { planId, ...updateData } = body;
  return updateWorkoutPlan(userId, planId, updateData);
}

export async function deleteWorkoutPlan(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);

  await WorkoutPlan.deleteOne({ _id: planId, userId });
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Workout plan deleted successfully'
  };
}

export async function deletePlanByQuery(userId, planId) {
  if (!planId) {
    const error = new Error('planId is required');
    error.statusCode = 400;
    throw error;
  }

  return deleteWorkoutPlan(userId, planId);
}

export async function activateWorkoutPlan(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);

  // Deactivate all other plans
  await WorkoutPlan.updateMany(
    { userId, _id: { $ne: planId } },
    { $set: { isActive: false } }
  );

  // Activate this plan
  plan.isActive = true;
  const activatedPlan = await plan.save();

  await invalidateWorkoutPlanCache(userId);

  return {
    success: true,
    plan: activatedPlan,
    message: 'Workout plan activated successfully'
  };
}

export async function deactivateWorkoutPlan(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);

  plan.isActive = false;
  const deactivatedPlan = await plan.save();

  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    plan: deactivatedPlan,
    message: 'Workout plan deactivated successfully'
  };
}

export async function generateAiWorkoutPlan(userId, body) {
  const {
    name,
    goal,
    difficulty,
    duration,
    equipment,
    targetMuscleGroups
  } = body;

  // For now, we'll create a structured plan based on templates.
  // In a real AI implementation, this would call Gemini or another LLM.
  const normalizedGoal = normalizeGoal(goal);
  const planDuration = duration || 4;
  const planName = name || `My AI ${normalizedGoal} Plan`;

  const weeks = [];
  for (let w = 1; w <= planDuration; w++) {
    const days = [];
    // Typical 3-day split: Push, Pull, Legs
    const workoutTypes = ['Push', 'Pull', 'Legs'];
    for (let d = 1; d <= 7; d++) {
      if (d === 1 || d === 3 || d === 5) {
        const typeIndex = (d - 1) / 2;
        days.push({
          dayNumber: d,
          workouts: [{
            name: `${workoutTypes[typeIndex]} Workout`,
            exercises: [], // Placeholder exercises
            isCompleted: false
          }],
          isCompleted: false
        });
      } else {
        days.push({
          dayNumber: d,
          workouts: [],
          isRestDay: true,
          isCompleted: false
        });
      }
    }
    weeks.push({
      weekNumber: w,
      days
    });
  }

  const plan = new WorkoutPlan({
    userId,
    name: planName,
    goal: normalizedGoal,
    difficulty: difficulty || 'Beginner',
    duration: planDuration,
    weeks,
    equipment: equipment || [],
    targetMuscleGroups: targetMuscleGroups || [],
    isActive: false,
    createdBy: 'system'
  });

  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  const savedPlan = await plan.save();
  await invalidateWorkoutPlanCache(userId);

  return {
    success: true,
    plan: savedPlan,
    message: 'AI workout plan generated successfully (Template based)'
  };
}

export async function cloneWorkoutPlan(userId, planId, newName) {
  const originalPlan = await getUserPlanOrError(userId, planId);

  if (!newName) {
    const error = new Error('Plan name is required');
    error.statusCode = 400;
    throw error;
  }

  const clonedPlanData = {
    userId,
    name: String(newName).trim(),
    description: `Copy of ${originalPlan.name}`,
    goal: originalPlan.goal,
    difficulty: originalPlan.difficulty,
    duration: originalPlan.duration,
    weeks: JSON.parse(JSON.stringify(originalPlan.weeks)),
    targetMuscleGroups: [...(originalPlan.targetMuscleGroups || [])],
    equipment: [...(originalPlan.equipment || [])],
    tags: [...(originalPlan.tags || []), 'cloned'],
    createdBy: 'user',
    isActive: false,
    isTemplate: false,
    isPublic: false
  };

  const clonedPlan = new WorkoutPlan(clonedPlanData);
  
  // Calculate and set stats
  const stats = calculatePlanStats(clonedPlan);
  clonedPlan.totalWorkoutsCount = stats.totalWorkoutsCount;
  clonedPlan.workoutFrequency = stats.workoutFrequency;

  const savedPlan = await clonedPlan.save();

  await invalidateWorkoutPlanCache(userId);

  return {
    success: true,
    plan: savedPlan,
    message: 'Workout plan cloned successfully'
  };
}

export async function getWorkoutStats(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);

  const stats = {
    totalWorkouts: 0,
    completedWorkouts: 0,
    totalDuration: 0,
    averageWorkoutDuration: 0,
    completionRate: 0,
    totalCalories: 0,
    exerciseStats: {
      totalExercises: 0,
      completedExercises: 0,
      personalRecords: []
    },
    muscleGroupDistribution: {},
    equipmentUsage: {},
    weeklyData: []
  };

  if (!plan.weeks || plan.weeks.length === 0) {
    return stats;
  }

  let totalCompletedWorkouts = 0;
  let totalPlannedWorkouts = 0;
  let totalActualDuration = 0;

  plan.weeks.forEach((week, weekIndex) => {
    const weekData = {
      week: week.weekNumber || weekIndex + 1,
      workouts: 0,
      completedWorkouts: 0,
      duration: 0,
      totalCalories: 0
    };

    week.days?.forEach(day => {
      if (!day.isRestDay && day.workouts) {
        day.workouts.forEach(workout => {
          totalPlannedWorkouts++;
          weekData.workouts++;

          if (workout.isCompleted) {
            totalCompletedWorkouts++;
            weekData.completedWorkouts++;

            const actualDuration = workout.actualDuration || workout.estimatedDuration || 0;
            totalActualDuration += actualDuration;
            weekData.duration += actualDuration;

            if (workout.caloriesBurned) {
              stats.totalCalories += workout.caloriesBurned;
              weekData.totalCalories += workout.caloriesBurned;
            }
          }

          if (workout.exercises) {
            workout.exercises.forEach(exercise => {
              stats.exerciseStats.totalExercises++;

              if (exercise.muscleGroups) {
                exercise.muscleGroups.forEach(group => {
                  stats.muscleGroupDistribution[group] = 
                    (stats.muscleGroupDistribution[group] || 0) + 1;
                });
              }

              if (exercise.equipment) {
                exercise.equipment.forEach(equip => {
                  stats.equipmentUsage[equip] = 
                    (stats.equipmentUsage[equip] || 0) + 1;
                });
              }

              if (exercise.isCompleted) {
                stats.exerciseStats.completedExercises++;
              }

              if (exercise.personalRecord) {
                stats.exerciseStats.personalRecords.push({
                  exercise: exercise.name,
                  weight: exercise.personalRecord.weight,
                  reps: exercise.personalRecord.reps,
                  date: exercise.personalRecord.date
                });
              }
            });
          }
        });
      }
    });

    weekData.completionRate = weekData.workouts > 0
      ? Math.round((weekData.completedWorkouts / weekData.workouts) * 100)
      : 0;

    stats.weeklyData.push(weekData);
  });

  stats.totalWorkouts = totalCompletedWorkouts;
  stats.totalDuration = Math.round(totalActualDuration);
  stats.averageWorkoutDuration = totalCompletedWorkouts > 0
    ? Math.round(totalActualDuration / totalCompletedWorkouts)
    : 0;

  stats.completionRate = totalPlannedWorkouts > 0
    ? Math.round((totalCompletedWorkouts / totalPlannedWorkouts) * 100)
    : 0;

  return {
    success: true,
    stats,
    planId: planId,
    planName: plan.name,
    lastUpdated: new Date().toISOString()
  };
}

// Granular workout plan management
export async function addWeek(userId, planId, weekData) {
  const plan = await getUserPlanOrError(userId, planId);
  const weekNumber = weekData.weekNumber || (plan.weeks.length + 1);
  
  const newWeek = {
    weekNumber,
    days: weekData.days || []
  };

  plan.weeks.push(newWeek);
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Week added successfully',
    week: newWeek
  };
}

export async function updateWeek(userId, planId, weekNumber, weekData) {
  const plan = await getUserPlanOrError(userId, planId);
  const weekIndex = plan.weeks.findIndex(w => w.weekNumber === Number(weekNumber));

  if (weekIndex === -1) {
    const error = new Error(`Week ${weekNumber} not found`);
    error.statusCode = 404;
    throw error;
  }

  Object.assign(plan.weeks[weekIndex], weekData);
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Week updated successfully',
    week: plan.weeks[weekIndex]
  };
}

export async function deleteWeek(userId, planId, weekNumber) {
  const plan = await getUserPlanOrError(userId, planId);
  const weekIndex = plan.weeks.findIndex(w => w.weekNumber === Number(weekNumber));

  if (weekIndex === -1) {
    const error = new Error(`Week ${weekNumber} not found`);
    error.statusCode = 404;
    throw error;
  }

  plan.weeks.splice(weekIndex, 1);
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Week deleted successfully'
  };
}

export async function addWorkoutToDay(userId, planId, weekNumber, dayNumber, workoutData) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  if (!week) {
    const error = new Error(`Week ${weekNumber} not found`);
    error.statusCode = 404;
    throw error;
  }

  let day = week.days.find(d => d.dayNumber === Number(dayNumber));
  if (!day) {
    day = { dayNumber: Number(dayNumber), workouts: [] };
    week.days.push(day);
  }

  const newWorkout = {
    name: workoutData.name || 'New Workout',
    exercises: workoutData.exercises || [],
    isCompleted: workoutData.isCompleted || false
  };

  day.workouts.push(newWorkout);
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Workout added successfully',
    workout: newWorkout
  };
}

export async function deleteWorkoutFromDay(userId, planId, weekNumber, dayNumber, workoutIndex) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  if (!week) throw new Error(`Week ${weekNumber} not found`);
  
  const day = week.days.find(d => d.dayNumber === Number(dayNumber));
  if (!day) throw new Error(`Day ${dayNumber} not found`);

  if (!day.workouts || workoutIndex < 0 || workoutIndex >= day.workouts.length) {
    throw new Error(`Workout at index ${workoutIndex} not found`);
  }

  day.workouts.splice(workoutIndex, 1);
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Workout deleted successfully'
  };
}

export async function clearDayWorkouts(userId, planId, weekNumber, dayNumber) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  if (!week) throw new Error(`Week ${weekNumber} not found`);
  
  const day = week.days.find(d => d.dayNumber === Number(dayNumber));
  if (day) {
    day.workouts = [];
  }
  
  // Update stats
  const stats = calculatePlanStats(plan);
  plan.totalWorkoutsCount = stats.totalWorkoutsCount;
  plan.workoutFrequency = stats.workoutFrequency;

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Day workouts cleared successfully'
  };
}

export async function addExercisesToWorkout(userId, planId, weekNumber, dayNumber, workoutIndex, exerciseData) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  const day = week?.days.find(d => d.dayNumber === Number(dayNumber));
  const workout = day?.workouts[Number(workoutIndex)];

  if (!workout) {
    const error = new Error('Workout not found');
    error.statusCode = 404;
    throw error;
  }

  const newExercises = Array.isArray(exerciseData.exercises) ? exerciseData.exercises : [exerciseData];
  workout.exercises = [...(workout.exercises || []), ...newExercises];

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Exercises added successfully',
    exercises: workout.exercises
  };
}

export async function getWorkoutExercises(userId, planId, weekNumber, dayNumber, workoutIndex) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  const day = week?.days.find(d => d.dayNumber === Number(dayNumber));
  const workout = day?.workouts[Number(workoutIndex)];

  if (!workout) {
    const error = new Error('Workout not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    success: true,
    exercises: workout.exercises || []
  };
}

export async function updateWorkoutExercises(userId, planId, weekNumber, dayNumber, workoutIndex, exerciseData) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  const day = week?.days.find(d => d.dayNumber === Number(dayNumber));
  const workout = day?.workouts[Number(workoutIndex)];

  if (!workout) {
    const error = new Error('Workout not found');
    error.statusCode = 404;
    throw error;
  }

  if (exerciseData.action === 'reorder' || exerciseData.action === 'update') {
    workout.exercises = exerciseData.exercises;
  } else {
    workout.exercises = exerciseData.exercises || workout.exercises;
  }

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Exercises updated successfully',
    exercises: workout.exercises
  };
}

export async function deleteExerciseFromWorkout(userId, planId, weekNumber, dayNumber, workoutIndex, exerciseIndex) {
  const plan = await getUserPlanOrError(userId, planId);
  const week = plan.weeks.find(w => w.weekNumber === Number(weekNumber));
  const day = week?.days.find(d => d.dayNumber === Number(dayNumber));
  const workout = day?.workouts[Number(workoutIndex)];

  if (!workout || !workout.exercises || exerciseIndex < 0 || exerciseIndex >= workout.exercises.length) {
    const error = new Error('Exercise not found');
    error.statusCode = 404;
    throw error;
  }

  workout.exercises.splice(exerciseIndex, 1);

  await plan.save();
  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Exercise deleted successfully'
  };
}

// Progress entry management
export async function addProgressEntry(userId, planId, progressData) {
  const plan = await getUserPlanOrError(userId, planId);

  if (!progressData || Object.keys(progressData).length === 0) {
    const error = new Error('Progress data is required');
    error.statusCode = 400;
    throw error;
  }

  const progressEntry = {
    date: progressData.date || new Date(),
    weight: progressData.weight && progressData.weight > 0 ? Number(progressData.weight) : undefined,
    bodyFat: progressData.bodyFat && progressData.bodyFat >= 0 && progressData.bodyFat <= 100 ? Number(progressData.bodyFat) : undefined,
    measurements: {},
    photos: progressData.photos || [],
    notes: progressData.notes ? String(progressData.notes).trim() : undefined
  };

  if (progressData.measurements) {
    const validMeasurements = ['chest', 'waist', 'hips', 'arms', 'thighs'];
    validMeasurements.forEach(measurement => {
      if (progressData.measurements[measurement] && progressData.measurements[measurement] > 0) {
        progressEntry.measurements[measurement] = Number(progressData.measurements[measurement]);
      }
    });
  }

  if (progressData.photos && Array.isArray(progressData.photos)) {
    progressEntry.photos = progressData.photos.filter(photo => {
      return photo.url && 
             ['front', 'side', 'back'].includes(photo.type) &&
             typeof photo.url === 'string';
    });
  }

  if (!plan.progress) {
    plan.progress = [];
  }

  plan.progress.push(progressEntry);
  await plan.save();

  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Progress entry added successfully',
    progressEntry,
    totalEntries: plan.progress.length
  };
}

export async function getProgressHistory(userId, planId) {
  const plan = await getUserPlanOrError(userId, planId);

  const progress = plan.progress?.sort((a, b) => new Date(b.date) - new Date(a.date)) || [];

  return {
    success: true,
    progress,
    planId: planId,
    planName: plan.name,
    totalEntries: progress.length
  };
}

export async function updateProgressEntry(userId, planId, progressId, updateData) {
  const plan = await getUserPlanOrError(userId, planId);

  if (!updateData || Object.keys(updateData).length === 0) {
    const error = new Error('Update data is required');
    error.statusCode = 400;
    throw error;
  }

  const progressEntryIndex = plan.progress.findIndex(
    entry => entry._id.toString() === progressId
  );

  if (progressEntryIndex === -1) {
    const error = new Error('Progress entry not found');
    error.statusCode = 404;
    throw error;
  }

  const currentEntry = plan.progress[progressEntryIndex];
  const updatedEntry = { ...currentEntry.toObject() };

  if (updateData.date) {
    updatedEntry.date = new Date(updateData.date);
  }

  if (updateData.weight !== undefined) {
    updatedEntry.weight = updateData.weight > 0 ? Number(updateData.weight) : undefined;
  }

  if (updateData.bodyFat !== undefined) {
    updatedEntry.bodyFat = (updateData.bodyFat >= 0 && updateData.bodyFat <= 100)
      ? Number(updateData.bodyFat)
      : undefined;
  }

  if (updateData.measurements) {
    updatedEntry.measurements = updatedEntry.measurements || {};
    const validMeasurements = ['chest', 'waist', 'hips', 'arms', 'thighs'];
    validMeasurements.forEach(measurement => {
      if (updateData.measurements[measurement] !== undefined) {
        if (updateData.measurements[measurement] > 0) {
          updatedEntry.measurements[measurement] = Number(updateData.measurements[measurement]);
        } else {
          delete updatedEntry.measurements[measurement];
        }
      }
    });
  }

  if (updateData.photos) {
    updatedEntry.photos = Array.isArray(updateData.photos)
      ? updateData.photos.filter(photo =>
          photo.url &&
          ['front', 'side', 'back'].includes(photo.type) &&
          typeof photo.url === 'string'
        )
      : [];
  }

  if (updateData.notes !== undefined) {
    updatedEntry.notes = updateData.notes ? String(updateData.notes).trim() : undefined;
  }

  plan.progress[progressEntryIndex] = updatedEntry;
  await plan.save();

  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Progress entry updated successfully',
    progressEntry: updatedEntry
  };
}

export async function deleteProgressEntry(userId, planId, progressId) {
  const plan = await getUserPlanOrError(userId, planId);

  const progressEntryIndex = plan.progress.findIndex(
    entry => entry._id.toString() === progressId
  );

  if (progressEntryIndex === -1) {
    const error = new Error('Progress entry not found');
    error.statusCode = 404;
    throw error;
  }

  const deletedEntry = plan.progress[progressEntryIndex];
  plan.progress.splice(progressEntryIndex, 1);
  await plan.save();

  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: 'Progress entry deleted successfully',
    deletedEntry: {
      _id: deletedEntry._id,
      date: deletedEntry.date
    },
    remainingEntries: plan.progress.length
  };
}

export async function getProgressEntry(userId, planId, progressId) {
  const plan = await getUserPlanOrError(userId, planId);

  const progressEntry = plan.progress.find(
    entry => entry._id.toString() === progressId
  );

  if (!progressEntry) {
    const error = new Error('Progress entry not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    success: true,
    progressEntry,
    planId: planId,
    planName: plan.name
  };
}

// Batch progress update
export async function batchUpdateProgressEntries(userId, planId, entries) {
  const plan = await getUserPlanOrError(userId, planId);

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    const error = new Error('entries array is required and must not be empty');
    error.statusCode = 400;
    throw error;
  }

  const results = {
    success: [],
    errors: [],
    totalProcessed: entries.length
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      if (!entry.date) {
        results.errors.push({
          index: i,
          error: 'Date is required for each entry'
        });
        continue;
      }

      const progressEntry = {
        date: new Date(entry.date),
        weight: entry.weight && entry.weight > 0 ? Number(entry.weight) : undefined,
        bodyFat: entry.bodyFat && entry.bodyFat >= 0 && entry.bodyFat <= 100 ? Number(entry.bodyFat) : undefined,
        measurements: {},
        photos: entry.photos || [],
        notes: entry.notes ? String(entry.notes).trim() : undefined
      };

      if (entry.measurements) {
        const validMeasurements = ['chest', 'waist', 'hips', 'arms', 'thighs'];
        validMeasurements.forEach(measurement => {
          if (entry.measurements[measurement] && entry.measurements[measurement] > 0) {
            progressEntry.measurements[measurement] = Number(entry.measurements[measurement]);
          }
        });
      }

      if (entry.photos && Array.isArray(entry.photos)) {
        progressEntry.photos = entry.photos.filter(photo => {
          return photo.url &&
                 ['front', 'side', 'back'].includes(photo.type) &&
                 typeof photo.url === 'string';
        });
      }

      const existingEntryIndex = plan.progress.findIndex(
        existing => existing.date.toDateString() === progressEntry.date.toDateString()
      );

      if (existingEntryIndex !== -1) {
        plan.progress[existingEntryIndex] = progressEntry;
        results.success.push({
          index: i,
          action: 'updated',
          date: progressEntry.date
        });
      } else {
        plan.progress.push(progressEntry);
        results.success.push({
          index: i,
          action: 'added',
          date: progressEntry.date
        });
      }
    } catch (entryError) {
      results.errors.push({
        index: i,
        error: entryError.message
      });
    }
  }

  plan.progress.sort((a, b) => new Date(b.date) - new Date(a.date));
  await plan.save();

  await invalidateWorkoutPlanCache(userId, planId);

  return {
    success: true,
    message: `Batch update completed. ${results.success.length} entries processed successfully, ${results.errors.length} errors.`,
    results,
    totalEntries: plan.progress.length
  };
}
