import mongoose from 'mongoose';

/**
 * Durable long-term memory fact about a user.
 * Only stable, repeatedly-observed preferences/constraints/delightful facts
 * should be promoted here — never raw chat noise.
 */
const UserMemoryFactSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    // goal | preference | constraint | injury | schedule | entity
    factType: {
      type: String,
      index: true,
    },
    // Normalized, human-readable fact e.g. "Prefers vegetarian meals"
    content: {
      type: String,
      required: true,
      trim: true,
    },
    // 0..1 confidence from the promotion pipeline
    confidence: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    // Number of independent observations that led to promotion
    observationCount: {
      type: Number,
      default: 1,
    },
    source: {
      type: String,
      trim: true,
      default: 'conversation',
    },
    // Comma/semantic tags for retrieval & dedup
    tags: {
      type: [String],
      default: [],
    },
    // Idempotency key computed from normalized content so retries
    // do not create duplicate facts.
    factHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

UserMemoryFactSchema.index({ userId: 1, factType: 1 });
UserMemoryFactSchema.index({ userId: 1, confidence: -1 });

const UserMemoryFact =
  mongoose.models.UserMemoryFact ||
  mongoose.model('UserMemoryFact', UserMemoryFactSchema);

export default UserMemoryFact;
