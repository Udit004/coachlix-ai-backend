import ChatSession from '../models/ChatSession.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { connectMongo } from '../db/mongo.js';
import { NotificationService } from '../module/diet/services/notificationService.js';
import { getEventBus } from './eventBus.js';

const recentlyProcessedEvents = new Map();
const DEDUP_TTL_MS = 2 * 60 * 1000;

function pruneProcessedEvents() {
  const now = Date.now();
  for (const [key, expiresAt] of recentlyProcessedEvents.entries()) {
    if (expiresAt <= now) {
      recentlyProcessedEvents.delete(key);
    }
  }
}

function claimEvent(event) {
  pruneProcessedEvents();

  const userId = String(event?.payload?.userId || '').trim();
  const sessionId = String(event?.payload?.sessionId || '').trim();
  const timestamp = String(event?.timestamp || '').trim();
  if (!userId || !sessionId || !timestamp) {
    return false;
  }

  const dedupKey = `${event.type}:${userId}:${sessionId}:${timestamp}`;
  if (recentlyProcessedEvents.has(dedupKey)) {
    return false;
  }

  recentlyProcessedEvents.set(dedupKey, Date.now() + DEDUP_TTL_MS);
  return true;
}

function buildNotificationPayload({ session, event }) {
  const sessionId = String(event.payload.sessionId);
  const plan = String(event.payload.plan || session?.plan || 'general').trim() || 'general';
  const titleBase = String(session?.title || '').trim();
  const notificationTitle = titleBase
    ? `Coachlix AI finished: ${titleBase.slice(0, 40)}`
    : 'Your Coachlix AI response is ready';

  return {
    title: notificationTitle,
    body: 'Tap to open the completed AI response.',
    data: {
      type: 'ai_response_completed',
      sessionId,
      plan,
      link: `/ai-chat?chatId=${sessionId}`,
    },
  };
}

export function registerAiCompletionNotificationWorker() {
  if (!env.aiCompletionPushNotificationsEnabled) {
    return null;
  }

  const bus = getEventBus();

  const handler = async (event) => {
    const userId = String(event?.payload?.userId || '').trim();
    const sessionId = String(event?.payload?.sessionId || '').trim();

    if (!userId || !sessionId) {
      return;
    }

    if (!claimEvent(event)) {
      return;
    }

    try {
      await connectMongo();

      const [user, session] = await Promise.all([
        User.findOne({ firebaseUid: userId }).select({ pushToken: 1, name: 1 }).lean(),
        ChatSession.findById(sessionId).select({ title: 1, plan: 1 }).lean(),
      ]);

      if (!user?.pushToken) {
        return;
      }

      const payload = buildNotificationPayload({ session, event });

      await NotificationService.sendCustomNotification(
        user.pushToken,
        payload.title,
        payload.body,
        payload.data
      );
    } catch (error) {
      console.error('[AiCompletionNotificationWorker] Failed to send push notification:', error.message);
    }
  };

  bus.on('turn.completed', handler);
  return handler;
}

export default {
  registerAiCompletionNotificationWorker,
};
