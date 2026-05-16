// Chat routes - endpoint definitions
import { createChatController } from "./controller.js";

export const registerChatModule = async (fastify, opts) => {
  const controller = createChatController();

  // POST /chat - Process message
  fastify.post("/", controller.processMessage);

  // GET /chat - Get user's sessions
  fastify.get("/", controller.getUserSessions);

  // POST /chat/session - Create new session
  fastify.post("/session", controller.createSession);

  // PUT /chat/:chatId - Update session
  fastify.put("/:chatId", controller.updateSession);

  // GET /chat/:chatId - Get specific session
  fastify.get("/:chatId", controller.getSession);

  // DELETE /chat/:chatId - Delete session
  fastify.delete("/:chatId", controller.deleteSession);

  // POST /chat/:chatId/clear - Clear history
  fastify.post("/:chatId/clear", controller.clearHistory);
};
