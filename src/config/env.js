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
  memorySummaryThreshold: toNumber(process.env.MEMORY_SUMMARY_THRESHOLD, 8),
memoryProfileTtlSeconds: toNumber(process.env.MEMORY_PROFILE_TTL_SECONDS, 60 * 60),
  memoryHotCacheTtlSeconds: toNumber(process.env.MEMORY_HOT_CACHE_TTL_SECONDS, 60 * 30),
  geminiSummarizerModel: process.env.GEMINI_SUMMARIZER_MODEL || 'gemini-2.5-flash',
memoryCooldownSeconds: toNumber(process.env.MEMORY_COOLDOWN_SECONDS, 5 * 60),
  memoryLlmMaxPerMinute: toNumber(process.env.MEMORY_LLM_MAX_PER_MINUTE, 10),
  // Minimum gap (seconds) between memory LLM runs for the SAME session. The
  // turn lock expires after this window, so at most ONE memory LLM call can
  // happen per session per gap window (never after every message).
  memoryTurnGapSeconds: toNumber(process.env.MEMORY_TURN_GAP_SECONDS, 120),
  // Per-user per-minute cap on memory LLM calls so a chatty user cannot
  // exhaust the shared global pool.
  memoryLlmMaxPerUserPerMinute: toNumber(
    process.env.MEMORY_LLM_MAX_PER_USER_PER_MINUTE,
    3
  ),

  // ── Goal-Based Agent (Redis caching) ───────────────────────────────────
  // TTL for the cached active goal per user. Goals change rarely, so a 1h
  // cache keeps hot lookups fast while staying fresh enough for progress /
  // status updates to be reflected quickly.
  goalActiveCacheTtlSeconds: toNumber(
    process.env.GOAL_ACTIVE_CACHE_TTL_SECONDS,
    60 * 60
  ),
// TTL for a "draft" goal that is awaiting clarification from the user.
  // After this window the draft expires so a stale partial goal is not
  // resumed later.
  goalDraftTtlSeconds: toNumber(process.env.GOAL_DRAFT_TTL_SECONDS, 60 * 30),
  // TTL for the per-turn agent plan (goal-based planner pause/resume). Kept
  // short so an in-flight plan does not linger after the exchange ends.
  turnPlanTtlSeconds: toNumber(process.env.TURN_PLAN_TTL_SECONDS, 60 * 20),

  firebaseAdminProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID || '',
  firebaseAdminPrivateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY || '',
  firebaseAdminClientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '',
  firebaseAdminCredentialsBase64:
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64 || '',
  firebaseAdminCredentials: process.env.FIREBASE_ADMIN_CREDENTIALS || '',
  aiCompletionPushNotificationsEnabled: toBoolean(
    process.env.AI_COMPLETION_PUSH_NOTIFICATIONS_ENABLED,
    true
  ),
  cloudName: process.env.CLOUD_NAME || '',
  cloudApiKey: process.env.CLOUD_API_KEY || '',
  cloudApiSecret: process.env.CLOUD_API_SECRET || '',
geminiApiKey: process.env.GEMINI_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openRouterModel: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
  groqSummarizerModel: process.env.GROQ_SUMMARIZER_MODEL || 'llama-3.3-70b-versatile',
  groqIntentModel: process.env.GROQ_INTENT_MODEL || 'llama-3.1-8b-instant',
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
