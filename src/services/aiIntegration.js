import { initializeLangSmith } from '../ai/config/langsmith.js';
import { getCompiledGraph } from '../ai_graph/graph/index.js';

export async function setupAIModule(_geminiApiKey) {
  initializeLangSmith();

  if (process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY.trim();
  }

  console.log('[AI] Initializing LangGraph runtime...');
  getCompiledGraph();
  console.log('[AI] LangGraph runtime ready');
}

export default {
  setupAIModule,
};
