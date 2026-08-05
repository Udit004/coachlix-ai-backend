// src/services/pineconeClient.js
// Lazy singleton Pinecone client + Gemini embeddings for long-term memory.
// Falls back to a graceful no-op when Pinecone is not configured OR when the
// SDK is not installed, so the rest of the memory pipeline (Redis + MongoDB)
// keeps working regardless.

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

import { env } from '../config/env.js';

let pineconeClient = null;
let memoryIndex = null;
let PineconeSdk = null;

/**
 * Returns true when Pinecone is available and enabled.
 */
export function isPineconeEnabled() {
  if (!env.usePinecone || !env.pineconeApiKey || !env.geminiApiKey) {
    return false;
  }

  // Ensure the SDK resolves if it is installed.
  if (!PineconeSdk) {
    try {
      // eslint-disable-next-line global-require
      PineconeSdk = require('@pinecone-database/pinecone');
    } catch {
      PineconeSdk = false;
    }
  }

  return PineconeSdk !== false;
}

/**
 * Lazily builds (and caches) the Pinecone client + memory index handle.
 * All external calls are guarded by isPineconeEnabled() at the call site.
 */
export function getPineconeIndex() {
  if (memoryIndex) {
    return memoryIndex;
  }

  if (!isPineconeEnabled()) {
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
 * Returns the shared Google Gemini embeddings instance used for vectorizing
 * memory chunks. Falls back to null when the API key is missing.
 */
export function getEmbeddings() {
  if (!env.geminiApiKey) {
    return null;
  }

  // Cache the instance on the module to avoid re-instantiation per call.
  if (!getPineconeIndex._embeddings) {
    getPineconeIndex._embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.geminiApiKey,
      modelName: env.pineconeEmbeddingModel || 'text-embedding-004',
    });
  }

  return getPineconeIndex._embeddings;
}

/**
 * Reset cached clients (mainly useful for tests / hot-reload).
 */
export function resetPineconeClient() {
  pineconeClient = null;
  memoryIndex = null;
  getPineconeIndex._embeddings = null;
}

export default {
  isPineconeEnabled,
  getPineconeIndex,
  getEmbeddings,
  resetPineconeClient,
};
