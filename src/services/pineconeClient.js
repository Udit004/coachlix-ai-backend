// src/services/pineconeClient.js
// Lazy singleton Pinecone client + Gemini embeddings for long-term memory.
// Falls back to a graceful no-op when Pinecone is not configured OR when the
// SDK is not installed, so the rest of the memory pipeline (Redis + MongoDB)
// keeps working regardless.
//
// NOTE: This is an ESM module ("type": "module"), so `require` is unavailable.
// We use dynamic `import()` to load the Pinecone SDK, and all functions that
// depend on it are async.
//
// Embeddings use the Google GenAI SDK directly (not the LangChain wrapper)
// so we can pass `outputDimensionality` to match the configured Pinecone index
// dimension (which is immutable after creation). The default index dimension
// is 1024, so we default `outputDimensionality` to 1024.

import { GoogleGenAI } from '@google/genai';

import { env } from '../config/env.js';

let pineconeClient = null;
let memoryIndex = null;
let PineconeSdk = null;
let pineconeSdkPromise = null;
let genaiClient = null;

/**
 * Async-load the Pinecone SDK once and cache the module namespace.
 * Returns null if it is not installed or cannot be imported.
 */
async function loadPineconeSdk() {
  if (PineconeSdk || pineconeSdkPromise) {
    return PineconeSdk;
  }

  pineconeSdkPromise = import('@pinecone-database/pinecone')
    .then((mod) => {
      PineconeSdk = mod;
      pineconeSdkPromise = null;
      return PineconeSdk;
    })
    .catch((error) => {
      console.warn('[Pinecone] SDK not available:', error?.message || error);
      PineconeSdk = false;
      pineconeSdkPromise = null;
      return null;
    });

  return pineconeSdkPromise;
}

/**
 * Returns true when Pinecone is available and enabled.
 */
export async function isPineconeEnabled() {
  if (!env.usePinecone || !env.pineconeApiKey || !env.geminiApiKey) {
    return false;
  }

  await loadPineconeSdk();
  return PineconeSdk !== false && PineconeSdk !== null;
}

/**
 * Lazily builds (and caches) the Pinecone client + memory index handle.
 */
export async function getPineconeIndex() {
  if (memoryIndex) {
    return memoryIndex;
  }

  if (!(await isPineconeEnabled())) {
    return null;
  }

  if (!pineconeClient) {
    pineconeClient = new PineconeSdk.Pinecone({
      apiKey: env.pineconeApiKey,
    });
  }

  memoryIndex = pineconeClient.index(env.pineconeIndexName);
  return memoryIndex;
}

/**
 * Embeds a single text string into a fixed-size vector using the Google GenAI
 * SDK with configurable output dimensionality. Falls back to null on error.
 */
async function embedText(text) {
  if (!env.geminiApiKey) {
    return null;
  }

  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }

  const model = env.pineconeEmbeddingModel || 'gemini-embedding-001';
  const dimension = env.pineconeEmbeddingDimension || 1024;

  const res = await genaiClient.models.embedContent({
    model,
    contents: String(text).slice(0, 8000),
    config: { outputDimensionality: dimension },
  });

  return res?.embeddings?.[0]?.values ?? null;
}

/**
 * Returns an embeddings object with the same async interface used by the
 * memory service (`embedQuery`), backed by the Google GenAI SDK.
 */
export function getEmbeddings() {
  return {
    embedQuery: async (text) => {
      const vector = await embedText(text);
      if (!vector) {
        throw new Error('[Pinecone] Failed to generate embedding');
      }
      return vector;
    },
  };
}

/**
 * Reset cached clients (mainly useful for tests / hot-reload).
 */
export function resetPineconeClient() {
  pineconeClient = null;
  memoryIndex = null;
  PineconeSdk = null;
  pineconeSdkPromise = null;
  genaiClient = null;
}

export default {
  isPineconeEnabled,
  getPineconeIndex,
  getEmbeddings,
  resetPineconeClient,
};
