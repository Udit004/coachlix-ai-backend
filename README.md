# Coachlix AI Backend (Fastify + WebSocket)

Fastify backend setup for the Coachlix frontend with HTTP routes and WebSocket support powered by `ws`.

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
- `WS /ws` websocket endpoint

## 4) WebSocket test (browser)

```js
const socket = new WebSocket('ws://localhost:8080/ws');

socket.onopen = () => {
  console.log('Connected');
  socket.send(JSON.stringify({ type: 'ping' }));
  socket.send(JSON.stringify({ type: 'broadcast', payload: { text: 'Hello Coachlix' } }));
};

socket.onmessage = (event) => {
  console.log('Message:', JSON.parse(event.data));
};
```

## Project structure

```text
src/
  app.js
  server.js
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
