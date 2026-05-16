import {
  deleteUserProfile,
  getUserProfile,
  updateUserProfile,
  uploadProfileImage
} from './service.js';

export async function registerProfileRoutes(fastify) {
  fastify.get('/userProfile', getUserProfile);
  fastify.put('/userProfile', updateUserProfile);
  fastify.delete('/userProfile', deleteUserProfile);
  fastify.post('/userProfile/image', uploadProfileImage);
}