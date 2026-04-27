# Coachlix AI Backend (Fastify + WebSocket)

Fastify backend for Coachlix with HTTP APIs and continuous WebSocket voice streaming to Gemini 2.5 Flash Live.

## 1) Install

```bash
npm install
```

## 2) Environment

Copy `.env.example` to `.env` and update values:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
GEMINI_API_KEY=your_gemini_api_key
GEMINI_LIVE_MODEL=gemini-2.5-flash-preview-native-audio-dialog
GEMINI_VOICE_NAME=Aoede
AUDIO_INPUT_MIME_TYPE=audio/pcm;rate=16000
LIVE_SYSTEM_INSTRUCTION=You are Coachlix AI fitness coach. Keep responses concise, practical, and safe.

LANGCHAIN_API_KEY=your_langsmith_key
LANGCHAIN_PROJECT=coachlix-ai-fitness
LANGCHAIN_VERBOSE=true
LANGCHAIN_TRACING_V2=true
```

## 3) Run

```bash
npm run dev
```

Server endpoints:
- `GET /` service status
- `GET /health` health check
- `GET /api/v1/ping` sample API route
- `GET /ws/stats` current websocket clients
- `WS /ws/live` live voice websocket endpoint

## 4) Live voice WS protocol

Connect from frontend:

```js
const ws = new WebSocket('ws://localhost:8080/ws/live');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('server:', msg);
};

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: 'start_session',
      systemInstruction:
        'You are Coachlix assistant. Help users with live coaching and motivation.',
      voiceName: 'Aoede',
      responseModalities: ['AUDIO', 'TEXT']
    })
  );
};
```

Client -> server events:

- `start_session`: opens Gemini Live session
- `audio_chunk`: `{ type: 'audio_chunk', audio: '<base64_pcm_data>', mimeType?: 'audio/pcm;rate=16000' }`
- `text_input`: `{ type: 'text_input', text: '...', turnComplete?: true }`
- `end_turn`: signals end of current realtime audio turn
- `stop_session`: closes Gemini session

Server -> client events:

- `connected`, `session_started`, `session_stopped`
- `gemini_live_open`, `gemini_live_closed`, `gemini_live_error`
- `gemini_text` with text chunks
- `gemini_audio` with base64 audio output and mime type
- `gemini_turn_complete`
- `error`

## 5) Example audio streaming flow

1. Capture microphone in frontend.
2. Convert to PCM16 mono chunks (16kHz recommended).
3. Base64 encode each chunk and send `audio_chunk` messages continuously.
4. Send `end_turn` when user pauses/stops speaking.
5. Play `gemini_audio` chunks as they arrive for low-latency voice responses.

## 6) LangChain tracing

LangChain/LangSmith tracing is enabled for live session lifecycle events when these env vars are set:

- `LANGCHAIN_API_KEY`
- `LANGCHAIN_PROJECT`
- `LANGCHAIN_TRACING_V2=true`

## Project structure

```text
src/
  app.js
  server.js
  ai/
    geminiLiveBridge.js
    langchainTracing.js
  config/
    env.js
  plugins/
    corePlugins.js
  routes/
    healthRoutes.js
    apiRoutes.js
  sockets/
    socketRoutes.js
```
