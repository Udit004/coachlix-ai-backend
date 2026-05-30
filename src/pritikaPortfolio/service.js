import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { env } from '../config/env.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const PROMPT_FILE_URL = new URL('./prompts/system.md', import.meta.url);
const KNOWLEDGE_FILE_URL = new URL('./prompts/GEMINI_PORTFOLIO_KNOWLEDGE.md', import.meta.url);

let cachedPrompt = null;
let cachedKnowledge = null;
let cachedCombinedPrompt = null;

const getPromptSource = async () => {
  if (cachedCombinedPrompt) {
    return cachedCombinedPrompt;
  }

  // load knowledge file (optional) and system prompt, then combine
  try {
    cachedKnowledge = await readFile(fileURLToPath(KNOWLEDGE_FILE_URL), 'utf8');
  } catch {
    cachedKnowledge = null;
  }

  try {
    cachedPrompt = await readFile(fileURLToPath(PROMPT_FILE_URL), 'utf8');
  } catch {
    cachedPrompt = 'You are the Pritika portfolio website assistant. Be concise, accurate, and helpful.';
  }

  cachedCombinedPrompt = cachedKnowledge
    ? `KNOWLEDGE BASE:\n${cachedKnowledge}\n\nSYSTEM INSTRUCTIONS:\n${cachedPrompt}`
    : `SYSTEM INSTRUCTIONS:\n${cachedPrompt}`;

  return cachedCombinedPrompt;
};

const buildPrompt = async ({ message, context }) => {
  const promptSource = await getPromptSource();
  const contextBlock = context && Object.keys(context).length
    ? `\n\nWebsite context:\n${JSON.stringify(context, null, 2)}`
    : '';

  return {
    promptSource,
    prompt: `${promptSource}\n\nUser message:\n${message}${contextBlock}`
  };
};

export async function generatePortfolioReply({ message, context = {} }) {
  const apiKey = env.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env.PRITIKA_GEMINI_MODEL || DEFAULT_MODEL;
  const { prompt, promptSource } = await buildPrompt({ message, context });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: 1200
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini request failed with status ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  return {
    text,
    model,
    promptSource
  };
}
