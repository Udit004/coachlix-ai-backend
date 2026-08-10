// src/module/calendar/index.js
import { registerCalendarController } from './calendarController.js';

export async function registerCalendarModule(fastify) {
  await registerCalendarController(fastify);
}
