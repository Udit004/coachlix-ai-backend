import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: toNumber(process.env.PORT, 8080),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  mongodbUri: process.env.MONGODB_URI || '',
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  redisUrl: process.env.REDIS_URL || '',
  bullmqEnabled: toBoolean(process.env.BULLMQ_ENABLED, true),
  memoryShortTermTurns: toNumber(process.env.MEMORY_SHORT_TERM_TURNS, 12),
  memoryShortTermTtlSeconds: toNumber(process.env.MEMORY_SHORT_TERM_TTL_SECONDS, 60 * 60 * 24 * 7),

  // ── Long-Term Memory (Pinecone + Redis + MongoDB) ──────────────────────
  usePinecone: toBoolean(process.env.USE_PINECONE, false),
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndexName: process.env.PINECONE_INDEX_NAME || 'coachlix-fitness',
  pineconeMemoryNamespace: process.env.PINECONE_MEMORY_NAMESPACE || 'memory',
pineconeEmbeddingModel: process.env.PINECONE_EMBEDDING_MODEL || 'gemini-embedding-001',
  pineconeEmbeddingDimension: toNumber(process.env.PINECONE_EMBEDDING_DIMENSION, 1024),
  memoryVectorTopK: toNumber(process.env.MEMORY_VECTOR_TOP_K, 5),
  memoryPromotionThreshold: toNumber(process.env.MEMORY_PROMOTION_THRESHOLD, 2),
  memorySummaryThreshold: toNumber(process.env.MEMORY_SUMMARY_THRESHOLD, 4),
memoryProfileTtlSeconds: toNumber(process.env.MEMORY_PROFILE_TTL_SECONDS, 60 * 60),
  memoryHotCacheTtlSeconds: toNumber(process.env.MEMORY_HOT_CACHE_TTL_SECONDS, 60 * 30),
  geminiSummarizerModel: process.env.GEMINI_SUMMARIZER_MODEL || 'gemini-2.5-flash-lite',
  memoryCooldownSeconds: toNumber(process.env.MEMORY_COOLDOWN_SECONDS, 5 * 60),
  memoryLlmMaxPerMinute: toNumber(process.env.MEMORY_LLM_MAX_PER_MINUTE, 10),

  firebaseAdminProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID || '',
  firebaseAdminPrivateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY || '',
  firebaseAdminClientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '',
  firebaseAdminCredentialsBase64:
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64 || '',
  firebaseAdminCredentials: process.env.FIREBASE_ADMIN_CREDENTIALS || '',
  cloudName: process.env.CLOUD_NAME || '',
  cloudApiKey: process.env.CLOUD_API_KEY || '',
  cloudApiSecret: process.env.CLOUD_API_SECRET || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiApiVersion: process.env.GEMINI_API_VERSION || 'v1alpha',
  geminiLiveModel:
    process.env.GEMINI_LIVE_MODEL ||
    'gemini-2.5-flash-native-audio-preview-12-2025',
  geminiVoiceName: process.env.GEMINI_VOICE_NAME || 'Aoede',
  audioInputMimeType:
    process.env.AUDIO_INPUT_MIME_TYPE || 'audio/pcm;rate=16000',
  liveSystemInstruction:
    process.env.LIVE_SYSTEM_INSTRUCTION ||
    'You are Coachlix AI fitness coach. Keep responses concise, practical, and safe.',
  langchainApiKey: process.env.LANGCHAIN_API_KEY || '',
  langchainProject: process.env.LANGCHAIN_PROJECT || 'coachlix-ai-fitness',
  langchainTracingV2: toBoolean(process.env.LANGCHAIN_TRACING_V2, false),
  langchainVerbose: toBoolean(process.env.LANGCHAIN_VERBOSE, false)
};
