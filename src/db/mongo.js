import mongoose from 'mongoose';

import { env } from '../config/env.js';

let isConnecting = null;

export async function connectMongo() {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI is not set. Add it to your backend .env file.');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (isConnecting) {
    return isConnecting;
  }

  isConnecting = mongoose
    .connect(env.mongodbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    })
    .then(() => mongoose.connection)
    .finally(() => {
      isConnecting = null;
    });

  return isConnecting;
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
