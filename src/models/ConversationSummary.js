import mongoose from 'mongoose';

/**
 * Compact summaries of conversation windows (session-level) and rolled-up
 * user-level summaries. Survives long after the raw transcript is pruned.
 */
const ConversationSummarySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    // session | user
    scope: {
      type: String,
      default: 'session',
      index: true,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    keyFacts: {
      type: [String],
      default: [],
    },
    topicsCovered: {
      type: [String],
      default: [],
    },
    windowStart: {
      type: Date,
    },
    windowEnd: {
      type: Date,
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    // Idempotency guard for the summarizer worker
    dedupKey: {
      type: String,
      unique: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

ConversationSummarySchema.index({ userId: 1, scope: 1, windowEnd: -1 });

const ConversationSummary =
  mongoose.models.ConversationSummary ||
  mongoose.model('ConversationSummary', ConversationSummarySchema);

export default ConversationSummary;
