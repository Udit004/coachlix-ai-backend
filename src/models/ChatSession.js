import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ['user', 'ai']
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const ChatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      maxlength: 100
    },
    plan: {
      type: String,
      default: 'general'
    },
    messages: [MessageSchema],
    messageCount: {
      type: Number,
      default: 0
    },
    lastMessage: {
      type: String,
      maxlength: 200,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isPinned: {
      type: Boolean,
      default: false
    },
    isArchived: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

ChatSessionSchema.index({ userId: 1, updatedAt: -1 });
ChatSessionSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });

ChatSessionSchema.pre('save', function onSave(next) {
  if (Array.isArray(this.messages) && this.messages.length > 0) {
    this.messageCount = this.messages.length;
    const lastMsg = this.messages[this.messages.length - 1];
    this.lastMessage = String(lastMsg.content || '').substring(0, 200);
  }

  // Kareem/Mongoose may call pre hooks with or without a `next` callback.
  // Only call `next` when it's provided (callback-style). For sync hooks
  // Mongoose will not pass `next` and expects the middleware to return
  // immediately (or return a Promise for async operations).
  if (typeof next === 'function') {
    next();
  }
});

const ChatSession =
  mongoose.models.ChatSession ||
  mongoose.model('ChatSession', ChatSessionSchema);

export default ChatSession;
