import { GoogleGenAI } from '@google/genai';

import { env } from '../config/env.js';
import { traceLiveEvent } from './langchainTracing.js';

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) {
    return null;
  }

  const textChunks = parts
    .map((part) => part?.text || part?.inlineText || part?.inline_text)
    .filter((value) => typeof value === 'string' && value.length > 0);

  return textChunks.length ? textChunks.join(' ') : null;
}

function extractInlineAudio(parts) {
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    const inlineData = part?.inlineData || part?.inline_data;

    if (inlineData?.data && (inlineData?.mimeType || inlineData?.mime_type)) {
      return {
        data: inlineData.data,
        mimeType: inlineData.mimeType || inlineData.mime_type
      };
    }
  }

  return null;
}

function normalizeResponseModalities(modalities) {
  if (!Array.isArray(modalities) || modalities.length === 0) {
    return ['AUDIO'];
  }

  const allowed = modalities
    .map((value) => String(value || '').toUpperCase())
    .filter((value) => value === 'AUDIO' || value === 'TEXT');

  if (allowed.includes('AUDIO')) {
    return ['AUDIO'];
  }

  return allowed.length > 0 ? [allowed[0]] : ['AUDIO'];
}

export class GeminiLiveBridge {
  constructor({ fastify, clientId, onServerEvent }) {
    if (!env.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for live voice mode');
    }

    this.fastify = fastify;
    this.clientId = clientId;
    this.onServerEvent = onServerEvent;
    this.ai = new GoogleGenAI({
      apiKey: env.geminiApiKey,
      apiVersion: env.geminiApiVersion
    });
    this.session = null;
    this.connected = false;
  }

  async connect({ systemInstruction, voiceName, responseModalities }) {
    const model = env.geminiLiveModel;
    const normalizedModalities = normalizeResponseModalities(responseModalities);
    const selectedVoice = voiceName || env.geminiVoiceName;

    const liveConfig = {
      responseModalities: normalizedModalities,
      systemInstruction: systemInstruction || env.liveSystemInstruction
    };

    if (normalizedModalities.includes('AUDIO')) {
      liveConfig.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: selectedVoice
          }
        }
      };
    }

    this.session = await this.ai.live.connect({
      model,
      config: liveConfig,
      callbacks: {
        onopen: async () => {
          this.connected = true;
          this.onServerEvent({
            type: 'gemini_live_open',
            model,
            apiVersion: env.geminiApiVersion,
            voiceName: selectedVoice,
            responseModalities: normalizedModalities
          });
          await traceLiveEvent('gemini_live_open', {
            clientId: this.clientId,
            model,
            apiVersion: env.geminiApiVersion,
            responseModalities: normalizedModalities
          });
        },
        onmessage: async (message) => {
          await this.handleGeminiMessage(message);
        },
        onerror: async (error) => {
          this.fastify.log.error({ error, clientId: this.clientId }, 'Gemini live error');
          this.onServerEvent({
            type: 'gemini_live_error',
            message: error?.message || 'Gemini live error'
          });
          await traceLiveEvent('gemini_live_error', {
            clientId: this.clientId,
            message: error?.message || 'unknown_error'
          });
        },
        onclose: async (event) => {
          this.connected = false;
          this.fastify.log.warn(
            {
              clientId: this.clientId,
              code: event?.code ?? null,
              reason: event?.reason || null,
              model,
              apiVersion: env.geminiApiVersion,
              responseModalities: normalizedModalities
            },
            'Gemini live closed'
          );

          this.onServerEvent({
            type: 'gemini_live_closed',
            code: event?.code ?? null,
            reason: event?.reason || null
          });
          await traceLiveEvent('gemini_live_closed', {
            clientId: this.clientId,
            code: event?.code ?? null
          });
        }
      }
    });
  }

  async handleGeminiMessage(message) {
    const payload = message || {};

    const dataPayload = payload.data || payload;
    const serverContent =
      payload.serverContent ||
      payload.server_content ||
      dataPayload?.serverContent ||
      dataPayload?.server_content;

    const modelTurn =
      serverContent?.modelTurn ||
      serverContent?.model_turn ||
      dataPayload?.modelTurn ||
      dataPayload?.model_turn;

    const parts = modelTurn?.parts || [];

    const text = extractTextFromParts(parts);
    if (text) {
      this.onServerEvent({
        type: 'gemini_text',
        text
      });
    }

    const audio = extractInlineAudio(parts);
    if (audio) {
      this.onServerEvent({
        type: 'gemini_audio',
        audio: audio.data,
        mimeType: audio.mimeType
      });
    }

    const turnComplete =
      Boolean(serverContent?.turnComplete) ||
      Boolean(serverContent?.turn_complete) ||
      Boolean(payload?.turnComplete) ||
      Boolean(payload?.turn_complete) ||
      Boolean(dataPayload?.turnComplete) ||
      Boolean(dataPayload?.turn_complete);

    if (turnComplete) {
      this.onServerEvent({ type: 'gemini_turn_complete' });
    }

    await traceLiveEvent('gemini_live_message', {
      clientId: this.clientId,
      hasText: Boolean(text),
      hasAudio: Boolean(audio),
      turnComplete
    });
  }

  ensureConnected() {
    if (!this.session || !this.connected) {
      throw new Error('Live session is not connected. Send start_session first.');
    }
  }

  async sendAudioChunk({ audioBase64, mimeType }) {
    this.ensureConnected();

    await this.session.sendRealtimeInput({
      media: {
        data: audioBase64,
        mimeType: mimeType || env.audioInputMimeType
      }
    });
  }

  async sendTextInput(text, turnComplete = true) {
    this.ensureConnected();

    await this.session.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [{ text }]
        }
      ],
      turnComplete
    });
  }

  async markEndOfTurn() {
    this.ensureConnected();
    await this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  async close() {
    if (this.session) {
      await this.session.close();
      this.session = null;
      this.connected = false;
    }
  }
}
