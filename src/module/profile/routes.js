import {
  deleteUserProfile,
  getUserProfile,
  updateUserProfile,
  uploadProfileImage,
  getUserRecentActivities,
  getUserAchievements
} from './service.js';

export async function registerProfileRoutes(fastify) {
  fastify.get('/userProfile', getUserProfile);
  fastify.put('/userProfile', updateUserProfile);
  fastify.delete('/userProfile', deleteUserProfile);
  fastify.post('/userProfile/image', uploadProfileImage);
  fastify.get('/userProfile/activities', getUserRecentActivities);
  fastify.get('/userProfile/achievements', getUserAchievements);
}