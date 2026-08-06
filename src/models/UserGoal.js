import mongoose from 'mongoose';

const GoalStepSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    action: { type: String, trim: true },
    tool: { type: String, trim: true, default: 'general' },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'skipped'],
      default: 'pending',
    },
    completedAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const TargetSchema = new mongoose.Schema(
  {
    startValue: { type: Number, default: null },
    currentValue: { type: Number, default: null },
    targetValue: { type: Number, default: null },
    unit: { type: String, trim: true, default: 'kg' },
    deadline: { type: Date, default: null },
  },
  { _id: false }
);

const ProgressSchema = new mongoose.Schema(
  {
    percent: { type: Number, default: 0, min: 0, max: 100 },
    lastCheckInAt: { type: Date, default: null },
    lastProgressAt: { type: Date, default: null },
    streak: { type: Number, default: 0 },
    stalledSince: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * Durable, goal-based representation of a user's fitness objective.
 * This is the core object the agent plans against, tracks progress on,
 * and proactively checks in on. Unlike raw memory facts, a goal is
 * structured with a measurable target and an actionable plan.
 */
const UserGoalSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['weight_loss', 'muscle_gain', 'endurance', 'general', 'nutrition'],
      default: 'general',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'completed', 'archived'],
      default: 'active',
    },
    target: {
      type: TargetSchema,
      default: () => ({}),
    },
    plan: {
      type: [GoalStepSchema],
      default: [],
    },
    progress: {
      type: ProgressSchema,
      default: () => ({}),
    },
    checkInFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'on_demand'],
      default: 'weekly',
    },
    source: {
      type: String,
      trim: true,
      default: 'conversation',
    },
  },
  {
    timestamps: true,
  }
);

UserGoalSchema.index({ userId: 1, status: 1 });
UserGoalSchema.index({ userId: 1, type: 1 });
UserGoalSchema.index({ userId: 1, updatedAt: -1 });

const UserGoal = mongoose.models.UserGoal || mongoose.model('UserGoal', UserGoalSchema);

export default UserGoal;
