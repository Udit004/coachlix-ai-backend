import mongoose from 'mongoose';

const WorkoutSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    exercises: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    isCompleted: {
      type: Boolean,
      default: false
    }
  },
  { _id: false }
);

const DaySchema = new mongoose.Schema(
  {
    dayNumber: {
      type: Number,
      required: true
    },
    workouts: {
      type: [WorkoutSchema],
      default: []
    },
    isCompleted: {
      type: Boolean,
      default: false
    }
  },
  { _id: false }
);

const WeekSchema = new mongoose.Schema(
  {
    weekNumber: {
      type: Number,
      required: true
    },
    days: {
      type: [DaySchema],
      default: []
    }
  },
  { _id: false }
);

const WorkoutPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: false
    },
    weeks: {
      type: [WeekSchema],
      default: []
    },
    stats: {
      totalWorkouts: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      averageWorkoutDuration: { type: Number, default: 0 },
      completionRate: { type: Number, default: 0 }
    },
    lastWorkoutDate: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

WorkoutPlanSchema.index({ userId: 1, createdAt: -1 });
WorkoutPlanSchema.index({ userId: 1, isActive: 1 });

const WorkoutPlan = mongoose.models.WorkoutPlan || mongoose.model('WorkoutPlan', WorkoutPlanSchema);

export default WorkoutPlan;