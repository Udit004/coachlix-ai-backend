import { connectMongo } from '../db/mongo.js';

export async function connectDB() {
  return connectMongo();
}

export async function disconnectDB() {
  const { disconnectMongo } = await import('../db/mongo.js');
  return disconnectMongo();
}
