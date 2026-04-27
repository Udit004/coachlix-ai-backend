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
