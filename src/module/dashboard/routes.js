import { verifyUserToken } from '../../shared/auth.js';

import { getDashboardOverview } from './service.js';

async function authenticate(request) {
  const authHeader = request.headers.authorization || request.headers.Authorization || '';
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw request.server.httpErrors.unauthorized('Authorization header missing');
  }

  try {
    const user = await verifyUserToken(authHeader);
    request.user = user;
    return user;
  } catch (error) {
    throw request.server.httpErrors.unauthorized(error.message || 'Unauthorized');
  }
}

export async function registerDashboardRoutes(fastify) {
  fastify.get('/overview', async (request, reply) => {
    try {
      const user = await authenticate(request);
      const payload = await getDashboardOverview(user.uid);

      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      return reply.code(200).send(payload);
    } catch (error) {
      const statusCode = error.statusCode || error.status || 500;
      return reply.code(statusCode).send({
        success: false,
        message: statusCode === 401 ? 'Unauthorized' : 'Failed to load dashboard overview',
        error: statusCode >= 500 ? error.message : undefined
      });
    }
  });
}