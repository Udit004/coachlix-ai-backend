// src/module/calendar/syncService.js
import { createEvent } from '../../services/googleCalendarService.js';

/**
 * Sync a newly created workout plan to the user's Google Calendar.
 * Currently creates a single calendar event representing the plan.
 * This can be expanded to create events for each workout session.
 *
 * @param {string} userId - MongoDB user ID
 * @param {object} plan   - Saved WorkoutPlan document
 */
export async function syncWorkoutPlanToCalendar(userId, plan) {
  if (!plan) return null;

  const startDate = plan.createdAt ? new Date(plan.createdAt) : new Date();
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // default 1 hour

  const event = {
    summary: plan.name || 'Workout Plan',
    description: plan.description || '',
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
  };

  try {
    const created = await createEvent(userId, event);
    return created;
  } catch (err) {
    console.error('Failed to sync workout plan to calendar:', err);
    return null;
  }
}
