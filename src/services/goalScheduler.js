// src/services/goalScheduler.js
// Proactive goal-based agent worker. Periodically checks active goals and
// emits a `goal.check_in.due` event when a goal is stalled, a check-in is
// overdue, or a milestone was reached. This is what makes the assistant
// *proactive* rather than purely reactive — it can nudge the user to stay
// on track. Runs off the hot request path via the event bus.

import { getEventBus } from './eventBus.js';
import { connectMongo } from '../db/mongo.js';
import UserGoal from '../models/UserGoal.js';
import { checkGoalMilestones } from './goalService.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let intervalHandle = null;

async function runGoalCheck() {
  try {
    await connectMongo();

    // Find all users who have an active goal. We check each active goal for
    // stalled / check-in-due / completed signals.
    const activeGoals = await UserGoal.find({ status: 'active' })
      .select('userId title type progress checkInFrequency target')
      .lean();

    if (activeGoals.length === 0) return 0;

    let dueCount = 0;
    for (const goal of activeGoals) {
      const signal = await checkGoalMilestones(goal.userId);
      if (!signal) continue;

      dueCount++;
      const bus = getEventBus();
      const event = {
        type: 'goal.check_in.due',
        payload: {
          userId: goal.userId,
          goalId: String(goal._id),
          reason: signal.reason,
          title: goal.title,
          percent: goal.progress?.percent || 0,
        },
        timestamp: new Date().toISOString(),
      };

      bus.emit(event.type, event);
      bus.emit('event', event);
    }

    return dueCount;
  } catch (error) {
    console.error('[GoalScheduler] check error:', error.message);
    return 0;
  }
}

/**
 * Register the proactive goal scheduler. It runs on an interval and also
 * reacts to `turn.persisted` events so a check-in can be considered right
 * after a conversation turn.
 */
export function registerGoalScheduler() {
  if (intervalHandle) return;

  const bus = getEventBus();

  const onTurn = async (event) => {
    if (!event?.payload?.sessionId) return;
    await runGoalCheck();
  };

  bus.on('turn.persisted', onTurn);

  // Run periodically regardless of chat activity.
  intervalHandle = setInterval(() => {
    runGoalCheck().catch((error) => {
      console.error('[GoalScheduler] interval error:', error.message);
    });
  }, CHECK_INTERVAL_MS);

  // Avoid keeping the process alive just for the timer in tests.
  if (intervalHandle.unref) intervalHandle.unref();

  return { onTurn, intervalHandle };
}

export function stopGoalScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export default {
  runGoalCheck,
  registerGoalScheduler,
  stopGoalScheduler,
};
