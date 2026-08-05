import ChatSession from '../models/ChatSession.js';
import { redis } from '../shared/cache.js';
import { env } from '../config/env.js';

const buildSessionKey = (userId, sessionId, suffix) =>
  `memory:session:${userId}:${sessionId}:${suffix}`;

const normalizeMessage = (message) => ({
  role: message.role,
  content: String(message.content || ''),
  timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString(),
});

const hasMeaningfulContent = (value) => String(value || '').trim().length > 0;

async function getCachedSession(userId, sessionId) {
  if (!userId || !sessionId) {
    return null;
  }

  const payload = await redis.get(buildSessionKey(userId, sessionId, 'state'));
  if (!payload) {
    return null;
  }

  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

async function setCachedSession(userId, sessionId, sessionState) {
  if (!userId || !sessionId || !sessionState) {
    return false;
  }

  await redis.set(
    buildSessionKey(userId, sessionId, 'state'),
    JSON.stringify(sessionState),
    'EX',
    env.memoryShortTermTtlSeconds
  );

  return true;
}

async function appendSessionMessage(userId, sessionId, message) {
  if (!userId || !sessionId || !message || !hasMeaningfulContent(message.content)) {
    return null;
  }

  const currentSession = (await getCachedSession(userId, sessionId)) || {
    userId,
    sessionId,
    messages: [],
    updatedAt: new Date().toISOString(),
  };

  currentSession.messages = [...(currentSession.messages || []), normalizeMessage(message)].slice(
    -env.memoryShortTermTurns * 2
  );
  currentSession.updatedAt = new Date().toISOString();
  currentSession.lastMessage = String(message.content || '').slice(0, 200);

  await setCachedSession(userId, sessionId, currentSession);
  await redis.set(
    buildSessionKey(userId, sessionId, 'turns'),
    JSON.stringify(currentSession.messages),
    'EX',
    env.memoryShortTermTtlSeconds
  );

  return currentSession;
}

async function persistConversationTurn(userId, sessionId, message, role) {
  if (!userId || !sessionId || !hasMeaningfulContent(message)) {
    return null;
  }

  const session = await ChatSession.findById(sessionId);
  const nextSession =
    session ||
    (await ChatSession.create({
      _id: sessionId,
      userId,
      title: 'New Chat',
      plan: 'general',
      messages: [],
      isActive: true,
    }));

  nextSession.userId = userId;
  nextSession.messages = nextSession.messages || [];
  nextSession.messages.push({
    role,
    content: String(message).trim(),
    timestamp: new Date(),
  });
  nextSession.messageCount = nextSession.messages.length;
  nextSession.lastMessage = String(message).substring(0, 200);

  await nextSession.save();
  return nextSession;
}

export const memoryService = {
  async loadSession(userId, sessionId) {
    const cachedSession = await getCachedSession(userId, sessionId);
    if (cachedSession) {
      return cachedSession;
    }

    if (!sessionId) {
      return null;
    }

    const session = await ChatSession.findById(sessionId).lean();
    if (!session) {
      return null;
    }

    const hydratedSession = {
      userId: session.userId,
      sessionId: session._id.toString(),
      messages: Array.isArray(session.messages)
        ? session.messages.map(normalizeMessage)
        : [],
      updatedAt: session.updatedAt?.toISOString?.() || new Date().toISOString(),
      lastMessage: session.lastMessage || '',
    };

    await setCachedSession(userId, sessionId, hydratedSession);
    return hydratedSession;
  },

  async appendUserMessage(userId, sessionId, message) {
    return appendSessionMessage(userId, sessionId, {
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
  },

  async appendAssistantMessage(userId, sessionId, message) {
    return appendSessionMessage(userId, sessionId, {
      role: 'ai',
      content: message,
      timestamp: new Date(),
    });
  },

  async persistTurn(userId, sessionId, role, content) {
    return persistConversationTurn(userId, sessionId, content, role);
  },

  async buildConversationHistory(userId, sessionId) {
    const session = await this.loadSession(userId, sessionId);
    return Array.isArray(session?.messages) ? session.messages : [];
  },
};
