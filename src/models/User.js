import mongoose from 'mongoose';

const AchievementSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    icon: { type: String, trim: true },
    earned: { type: Boolean, default: false },
    earnedDate: { type: Date, default: null }
  },
  { _id: false }
);

const ActivitySchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    duration: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
    date: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const StatsSchema = new mongoose.Schema(
  {
    workoutsCompleted: { type: Number, default: 0 },
    daysStreak: { type: Number, default: 0 },
    caloriesBurned: { type: Number, default: 0 },
    totalHours: { type: Number, default: 0 }
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    name: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    location: {
      type: String,
      trim: true
    },
    birthDate: {
      type: Date,
      default: null
    },
    fitnessGoal: {
      type: String,
      trim: true
    },
    experience: {
      type: String,
      trim: true
    },
    gender: {
      type: String,
      trim: true
    },
    activityLevel: {
      type: String,
      trim: true
    },
    age: {
      type: Number,
      default: null
    },
    height: {
      type: Number,
      default: null
    },
    weight: {
      type: Number,
      default: null
    },
    targetWeight: {
      type: Number,
      default: null
    },
    bio: {
      type: String,
      trim: true
    },
    profileImage: {
      type: String,
      trim: true,
      default: null
    },
    pushToken: {
      type: String,
      default: null,
      trim: true
    },
    profileCompleted: {
      type: Boolean,
      default: false
    },
    stats: {
      type: StatsSchema,
      default: () => ({})
    },
    achievements: {
      type: [AchievementSchema],
      default: []
    },
    recentActivities: {
      type: [ActivitySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;