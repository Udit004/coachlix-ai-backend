import { EventEmitter } from 'node:events';

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '../config/env.js';

const localEmitter = new EventEmitter();
let redisConnection = null;
let eventQueue = null;
let eventWorker = null;

const getRedisConnection = () => {
  if (!env.redisUrl) {
    return null;
  }

  if (!redisConnection) {
    redisConnection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  return redisConnection;
};

export function getEventBus() {
  return localEmitter;
}

export async function initializeEventBus(fastify) {
  const connection = getRedisConnection();

  if (!env.bullmqEnabled || !connection) {
    fastify?.log?.warn?.('BullMQ event bus disabled because REDIS_URL is missing or disabled');
    return { enabled: false };
  }

  eventQueue = new Queue('coachlix-ai-events', {
    connection,
    defaultJobOptions: {
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  });

  eventWorker = new Worker(
    'coachlix-ai-events',
    async (job) => {
      const event = job.data || {};
      localEmitter.emit(event.type, event);
      localEmitter.emit('event', event);
      fastify?.log?.info?.({ eventType: event.type, jobId: job.id }, 'AI event processed');
      return { processed: true };
    },
    {
      connection,
      concurrency: 5,
    }
  );

  eventWorker.on('failed', (job, error) => {
    fastify?.log?.error?.({ jobId: job?.id, err: error }, 'AI event processing failed');
  });

  fastify?.log?.info?.('BullMQ event bus initialized');
  return { enabled: true };
}

export async function emitAiEvent(type, payload = {}) {
  const event = {
    type,
    payload,
    timestamp: new Date().toISOString(),
  };

  // ALWAYS emit locally first so in-process subscribers (memory promotion,
  // summarizer, etc.) run immediately regardless of BullMQ availability.
  localEmitter.emit(type, event);
  localEmitter.emit('event', event);

  // Optionally ALSO enqueue to BullMQ for durable/async processing.
  if (eventQueue) {
    void eventQueue.add(type, event).catch((error) => {
      console.warn('[EventBus] BullMQ publish failed (local delivery succeeded):', error?.message || error);
    });
  }

  return event;
}

export async function closeEventBus() {
  if (eventWorker) {
    await eventWorker.close();
    eventWorker = null;
  }

  if (eventQueue) {
    await eventQueue.close();
    eventQueue = null;
  }

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}
