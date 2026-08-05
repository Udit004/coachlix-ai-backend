// src/ai/graph/fitness/nodes/toolsNode.js

import { ToolMessage } from "@langchain/core/messages";
import { getToolByName } from "../../../tools/index.js";

const emitEvent = (state, type, payload) => {
  if (typeof state?.onEvent === "function") {
    try {
      state.onEvent({ type, ...payload });
    } catch (error) {
      console.error(`[Graph:tools] onEvent failed for ${type}:`, error?.message || error);
    }
  }
};

export async function toolsNode(state) {
  const { messages, userId } = state;
  const lastMessage = messages[messages.length - 1];
  const toolCalls = lastMessage?.tool_calls ?? [];

  if (toolCalls.length === 0) {
    console.log("[Graph:tools] No tool calls - skipping");
    return {};
  }

  console.log(
    `[Graph:tools] Executing ${toolCalls.length} tool(s) in PARALLEL: ` +
      toolCalls.map((tc) => tc.name).join(", ")
  );
  const t0 = Date.now();

  emitEvent(state, "ai.tool.requested", {
    userId,
    tools: toolCalls.map((tc) => tc.name),
    count: toolCalls.length,
  });

  const toolMessages = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const args = { ...toolCall.args };
      if (!args.userId) args.userId = userId;

      const toolFn = getToolByName(toolCall.name);
      let content;

      if (!toolFn) {
        console.error(`[Graph:tools] Unknown tool: "${toolCall.name}"`);
        content = `Error: Tool "${toolCall.name}" is not available.`;
      } else {
        try {
          const result = await toolFn(args);
          content = typeof result === "string" ? result : JSON.stringify(result);
          console.log(`[Graph:tools] ${toolCall.name} done`);
        } catch (err) {
          console.error(`[Graph:tools] ${toolCall.name} failed:`, err.message);
          content = `Error executing ${toolCall.name}: ${err.message}`;
        }
      }

      return new ToolMessage({
        content,
        tool_call_id: toolCall.id,
        name: toolCall.name,
      });
})
  );

  const elapsed = Date.now() - t0;
  console.log(
    `[Graph:tools] All ${toolCalls.length} tool(s) resolved in ${elapsed} ms`
  );

  emitEvent(state, "ai.tool.completed", {
    userId,
    tools: toolCalls.map((tc) => tc.name),
    count: toolCalls.length,
    durationMs: elapsed,
  });

  return {
    messages: toolMessages,
    toolsUsed: toolCalls.map((tc) => tc.name),
  };
}
