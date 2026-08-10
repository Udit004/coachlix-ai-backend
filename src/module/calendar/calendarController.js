// src/module/calendar/calendarController.js
import { createEvent, revokeAccess } from '../../services/googleCalendarService.js';
import User from '../../models/User.js';
import { verifyUserToken } from '../../shared/auth.js';

async function getUidFromRequest(req, reply) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader) {
    reply.code(401).send({ error: 'Authorization header missing' });
    return null;
  }
  try {
    const user = await verifyUserToken(authHeader);
    return user.uid;
  } catch (err) {
    reply.code(401).send({ error: 'Unauthenticated', message: err.message });
    return null;
  }
}

export async function registerCalendarController(fastify) {
  fastify.post('/sync', async (request, reply) => {
    const userId = await getUidFromRequest(request, reply);
    if (!userId) return;

    const { summary, description, start, end } = request.body;
    if (!summary || !start || !end) return reply.code(400).send({ error: 'Missing fields' });
    try {
      const event = {
        summary,
        description: description || '',
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
      };
      const created = await createEvent(userId, event);
      return reply.send({ success: true, event: created });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Failed to create event' });
    }
  });

  fastify.get('/status', async (request, reply) => {
    const userId = await getUidFromRequest(request, reply);
    if (!userId) return;

    const user = await User.findOne({ firebaseUid: userId }).select('calendarSyncEnabled tokenExpiry');
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const tokenValid = !!(user.tokenExpiry && new Date() < user.tokenExpiry);
    return reply.send({ calendarSyncEnabled: !!user.calendarSyncEnabled, tokenValid });
  });

  fastify.post('/revoke', async (request, reply) => {
    const userId = await getUidFromRequest(request, reply);
    if (!userId) return;

    try {
      await revokeAccess(userId);
      return reply.send({ success: true });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Failed to revoke' });
    }
  });
}
