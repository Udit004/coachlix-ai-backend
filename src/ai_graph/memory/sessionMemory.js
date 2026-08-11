// src/ai/memory/sessionMemory.js
// Redis-backed short-term session memory with sliding window + rolling summary.
// Used for fast intent-classifier context without hitting MongoDB every turn.

import { cache } from '../../lib/redis.js';
import { env } from '../../config/env.js';

const SLIDING_WINDOW_SIZE = 20;
const SUMMARY_MAX_CHARS = 1200;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sessionMessageKey(userId, sessionId) {
  return `session:memory:${userId}:${sessionId}:messages`;
}

function sessionSummaryKey(userId, sessionId) {
  return `session:memory:${userId}:${sessionId}:summary`;
}

export async function getSessionMessages(userId, sessionId) {
  if (!userId || !sessionId) return [];
  try {
    const raw = await cache.get(sessionMessageKey(userId, sessionId));
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function appendSessionMessage(userId, sessionId, role, content) {
  if (!userId || !sessionId || !content) return;
  const key = sessionMessageKey(userId, sessionId);
  const messages = await getSessionMessages(userId, sessionId);
  messages.push({ role, content: String(content).slice(0, 4000), ts: Date.now() });
  if (messages.length > SLIDING_WINDOW_SIZE) {
    messages.splice(0, messages.length - SLIDING_WINDOW_SIZE);
  }
  try {
    await cache.set(key, messages, SESSION_TTL_SECONDS);
  } catch {
    // ignore redis failures
  }
}

export async function getSessionSummary(userId, sessionId) {
  if (!userId || !sessionId) return '';
  try {
    const raw = await cache.get(sessionSummaryKey(userId, sessionId));
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

export async function updateSessionSummary(userId, sessionId, latestExchange) {
  if (!userId || !sessionId || !latestExchange) return;
  const key = sessionSummaryKey(userId, sessionId);
  const existing = await getSessionSummary(userId, sessionId);
  const userText = String(latestExchange.user || '').trim();
  const assistantText = String(latestExchange.assistant || '').trim();
  if (!userText && !assistantText) return;

  const newLines = [];
  if (userText) newLines.push(`User: ${userText.slice(0, 300)}`);
  if (assistantText) newLines.push(`Assistant: ${assistantText.slice(0, 300)}`);

  const addition = newLines.join('\n');
  let summary = existing
    ? `${existing}\n${addition}`
    : addition;

  if (summary.length > SUMMARY_MAX_CHARS) {
    const lines = summary.split('\n');
    const keep = lines.slice(-12);
    summary = keep.join('\n');
    if (summary.length > SUMMARY_MAX_CHARS) {
      summary = summary.slice(-SUMMARY_MAX_CHARS);
    }
  }

  try {
    await cache.set(key, summary, SESSION_TTL_SECONDS);
  } catch {
    // ignore
  }
}

export async function buildClassifierContext(userId, sessionId, currentMessage) {
  const [messages, summary] = await Promise.all([
    getSessionMessages(userId, sessionId),
    getSessionSummary(userId, sessionId),
  ]);

  const recentWindow = messages.slice(-8);
  const recentText = recentWindow
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const parts = [];
  if (summary.trim()) {
    parts.push(`SESSION SUMMARY (earlier in this chat):\n${summary.trim()}`);
  }
  if (recentText.trim()) {
    parts.push(`RECENT MESSAGES:\n${recentText}`);
  }
  parts.push(`CURRENT MESSAGE: ${String(currentMessage || '')}`);

  return parts.join('\n\n');
}
