import ChatSession from '../../models/ChatSession.js';
import User from '../../models/User.js';
import { redis } from '../../shared/cache.js';
import { processAiChat } from '../../ai_graph/index.js';

async function getConversationHistory(chatId) {
  if (!chatId) {
    return [];
  }

  try {
    const chatSession = await ChatSession.findById(chatId).lean();
    return Array.isArray(chatSession?.messages) ? chatSession.messages : [];
  } catch (error) {
    console.error('[Chat Service] Error fetching chat history:', error);
    return [];
  }
}

async function getUserProfile(userId) {
  try {
    const cacheKey = `user-profile:${userId}`;
    const cachedProfile = await redis.get(cacheKey);

    if (cachedProfile) {
      return typeof cachedProfile === 'string'
        ? JSON.parse(cachedProfile)
        : cachedProfile;
    }

    const user = await User.findOne({ firebaseUid: userId }).lean();
    if (!user) {
      return null;
    }

    const profile = {
      name: user.name,
      email: user.email,
      fitnessGoal: user.fitnessGoal,
      experience: user.experience,
      gender: user.gender,
      activityLevel: user.activityLevel,
      age: user.age,
      height: user.height,
      weight: user.weight,
      targetWeight: user.targetWeight,
      bio: user.bio,
    };

    await redis.set(cacheKey, JSON.stringify(profile), 'EX', 86400);
    return profile;
  } catch (error) {
    console.error('[Chat Service] Error fetching profile:', error);
    return null;
  }
}

export const chatService = {
  async streamMessage(userId, data, onChunk) {
    const { message, plan = 'general', chatId, files } = data;

    if (!message || !userId) {
      throw new Error('Message and userId are required');
    }

    const [conversationHistory, profile] = await Promise.all([
      getConversationHistory(chatId),
      getUserProfile(userId),
    ]);

    const sessionId = chatId || `chat_${userId}_${Date.now()}`;
    const result = await processAiChat(
      {
        message,
        files,
        userId,
        plan,
        profile,
        conversationHistory,
      },
      onChunk
    );

    return {
      ...result,
      chatId: sessionId,
      profileAvailable: Boolean(profile),
      hasHistory: conversationHistory.length > 0,
    };
  },

  async processMessage(userId, data) {
    return this.streamMessage(userId, data, null);
  },

  async getChatSession(chatId) {
    try {
      return await ChatSession.findById(chatId);
    } catch (error) {
      console.error('[Chat Service] Error fetching chat session:', error);
      throw error;
    }
  },

  async getUserSessions(userId, limit = 20) {
    try {
      const chats = await ChatSession.find({ userId, isActive: true })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      return {
        chats,
        totalCount: chats.length,
        hasMore: chats.length >= limit,
      };
    } catch (error) {
      console.error('[Chat Service] Error fetching user sessions:', error);
      throw error;
    }
  },

  async createSession(userId, title, plan = 'general', messages = []) {
    try {
      const session = await ChatSession.create({
        userId,
        title: title || 'New Chat',
        plan,
        messages: Array.isArray(messages)
          ? messages.map((message) => ({
              role: message.role,
              content: message.content,
              timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
            }))
          : [],
      });
      return session;
    } catch (error) {
      console.error('[Chat Service] Error creating chat session:', error);
      throw error;
    }
  },

  async updateSession(chatId, userId, updates = {}) {
    try {
      const payload = {};

      if (typeof updates.title === 'string' && updates.title.trim()) {
        payload.title = updates.title.trim();
      }

      if (typeof updates.plan === 'string' && updates.plan.trim()) {
        payload.plan = updates.plan.trim();
      }

      if (typeof updates.isPinned === 'boolean') {
        payload.isPinned = updates.isPinned;
      }

      if (typeof updates.isArchived === 'boolean') {
        payload.isArchived = updates.isArchived;
      }

      if (Array.isArray(updates.messages)) {
        payload.messages = updates.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
        }));
      }

      const session = await ChatSession.findOneAndUpdate(
        { _id: chatId, userId },
        payload,
        { new: true, runValidators: true }
      );

      if (!session) {
        throw new Error('Chat session not found');
      }

      return session;
    } catch (error) {
      console.error('[Chat Service] Error updating chat session:', error);
      throw error;
    }
  },

  async deleteSession(chatId, userId) {
    try {
      const session = await ChatSession.findOneAndUpdate(
        { _id: chatId, userId },
        { isActive: false },
        { new: true }
      );
      if (!session) {
        throw new Error('Chat session not found');
      }
      return session;
    } catch (error) {
      console.error('[Chat Service] Error deleting chat session:', error);
      throw error;
    }
  },

  async clearHistory(chatId) {
    try {
      return await ChatSession.findByIdAndUpdate(
        chatId,
        { messages: [] },
        { new: true }
      );
    } catch (error) {
      console.error('[Chat Service] Error clearing chat history:', error);
      throw error;
    }
  },
};

export const registerChatModule = async () => {};
