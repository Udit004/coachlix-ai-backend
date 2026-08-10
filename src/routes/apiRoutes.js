import { registerDietModule } from '../module/diet/index.js';
import { registerCalendarModule } from '../module/calendar/index.js';
import { registerOAuthController } from '../module/calendar/oauthController.js';
import { registerWorkoutModule } from '../module/workout/index.js';
import { registerDashboardModule } from '../module/dashboard/index.js';
import { registerProfileModule } from '../module/profile/index.js';
import { registerChatModule } from '../module/chat/routes.js';
import { registerExercisesModule } from '../module/exercises/routes.js';
import { registerFoodsModule } from '../module/foods/routes.js';
import { registerPritikaPortfolioModule } from '../pritikaPortfolio/index.js';
import { registerGoalModule } from '../module/goal/index.js';


export async function apiRoutes(fastify) {
  fastify.get('/ping', async () => ({
    message: 'pong',
    time: new Date().toISOString()
  }));

  await fastify.register(registerDietModule, { prefix: '/diet-plans' });
  await fastify.register(registerWorkoutModule, { prefix: '/workout-plans' });
  await fastify.register(registerChatModule, { prefix: '/chat' });
  await fastify.register(registerExercisesModule, { prefix: '/exercises' });
  await fastify.register(registerFoodsModule, { prefix: '/foods' });
  await fastify.register(registerPritikaPortfolioModule, {
    prefix: '/pritika-portfolio'
  });
await fastify.register(registerDashboardModule);
  await fastify.register(registerProfileModule);
  await fastify.register(registerGoalModule, { prefix: '/goals' });
  await fastify.register(registerCalendarModule, { prefix: '/calendar' });
  await fastify.register(registerOAuthController, { prefix: '/calendar' });

}
