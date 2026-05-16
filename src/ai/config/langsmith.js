import { Client as LangSmithClient } from 'langsmith';

import { env } from '../../config/env.js';

let langsmithClient = null;
let initialized = false;

export function initializeLangSmith() {
  if (initialized) {
    return langsmithClient;
  }

  initialized = true;

  if (!env.langchainTracingV2 || !env.langchainApiKey) {
    console.log('[LangSmith] Tracing disabled');
    return null;
  }

  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_API_KEY = env.langchainApiKey;
  process.env.LANGCHAIN_PROJECT = env.langchainProject;
  process.env.LANGCHAIN_VERBOSE = env.langchainVerbose ? 'true' : 'false';

  try {
    langsmithClient = new LangSmithClient({
      apiKey: env.langchainApiKey,
    });

    console.log(`[LangSmith] Tracing enabled for project "${env.langchainProject}"`);
  } catch (error) {
    console.warn(`[LangSmith] Initialization failed: ${error.message}`);
    langsmithClient = null;
  }

  return langsmithClient;
}

export function getLangSmithClient() {
  if (!initialized) {
    initializeLangSmith();
  }

  return langsmithClient;
}

export function isLangSmithEnabled() {
  return Boolean(getLangSmithClient());
}

export function reinitializeLangSmith() {
  initialized = false;
  langsmithClient = null;
  return initializeLangSmith();
}

export default langsmithClient;
