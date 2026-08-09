// src/ai_graph/mcp/mcpClient.js
// MCP (Model Context Protocol) CLIENT layer for Coachlix.
//
// This module lets the LangGraph agent call EXTERNAL MCP tool servers
// (internet search, live nutrition databases, etc.) in addition to the
// internal toolRegistry. It is intentionally additive and off by default:
//   - If MCP_SERVERS_ENABLED is false, nothing here does anything.
//   - If a configured server is unreachable, individual tool calls return a
//     clear error string instead of throwing, so the graph never crashes.
//
// Supported transports:
//   - "http"  -> StreamableHTTPClientTransport (remote MCP server)
//   - "stdio" -> StdioClientTransport (local subprocess via MCP_SERVER_COMMANDS)

import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env } from '../../config/env.js';

const DEFAULT_SERVER_ID = 'mcp-default';

// ── Server registry ──────────────────────────────────────────────────────
// Each entry: { id, label, transportType, options, client, tools(Map), state }
const servers = new Map();

let initialized = false;

// ── Helpers ──────────────────────────────────────────────────────────────

function parseHeaders(raw = '') {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseServerCommands(raw = '') {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hintFromUrl(url) {
  if (/search|brave|tavily|google|web/i.test(url)) return 'search';
  if (/nutrition|food|calorie|meal|recipe/i.test(url)) return 'nutrition';
  return 'general';
}

function getConfiguredHttpServers() {
  const urls = (env.mcpServerUrls || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const headersByUrl = parseHeaders(env.mcpServerHeaders);

  return urls.map((url, idx) => {
    const id = `http-${idx + 1}`;
    return {
      id,
      label: url,
      transportType: 'http',
      hint: hintFromUrl(url),
      options: {
        url,
        headers: headersByUrl[url] ? { Authorization: headersByUrl[url] } : {},
      },
    };
  });
}

function getConfiguredStdioServers() {
  return parseServerCommands(env.mcpServerCommands).map((cfg, idx) => {
    const id = cfg.id || `stdio-${idx + 1}`;
    return {
      id,
      label: cfg.name || cfg.command || id,
      transportType: 'stdio',
      hint: hintFromUrl(cfg.name || cfg.command || ''),
      options: {
        command: cfg.command,
        args: cfg.args || [],
        env: cfg.env || {},
        cwd: cfg.cwd,
        stderr: 'pipe',
      },
    };
  });
}

function buildServerConfigs() {
  const configs = [];
  if (env.mcpTransport === 'stdio') {
    configs.push(...getConfiguredStdioServers());
  } else {
    configs.push(...getConfiguredHttpServers());
  }
  // Fallback: if nothing configured, still connect to an empty default so the
  // registry has a stable shape (no-op, tools list empty).
  if (configs.length === 0) {
    configs.push({
      id: DEFAULT_SERVER_ID,
      label: 'none',
      transportType: 'http',
      hint: 'general',
      options: null,
    });
  }
  return configs;
}

async function openClient(cfg) {
  if (!cfg.options) return { client: null, transport: null };

  let transport;
  if (cfg.transportType === 'stdio') {
    transport = new StdioClientTransport({
      command: cfg.options.command,
      args: cfg.options.args,
      env: cfg.options.env,
      cwd: cfg.options.cwd,
      stderr: 'pipe',
    });
  } else {
    transport = new StreamableHTTPClientTransport({
      url: cfg.options.url,
      headers: cfg.options.headers,
      requestTimeout: env.mcpToolTimeoutMs,
    });
  }

  const client = new Client(
    { name: 'coachlix-ai-backend', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

// ── Lifecycle ────────────────────────────────────────────────────────────

/**
 * Connect to all configured MCP servers and build a pooled tool registry.
 * Safe to call multiple times (idempotent). Never throws during connect;
 * failures are logged and the server is skipped so the graph keeps working.
 */
export async function initMcpClient() {
  if (initialized) return getMcpStatus();
  initialized = true;

  if (!env.mcpServersEnabled) {
    return { enabled: false, servers: [], tools: [] };
  }

  const configs = buildServerConfigs();

  for (const cfg of configs) {
    try {
      const { client, transport } = await openClient(cfg);
      const toolsResult = await client.listTools();
      const toolsList = toolsResult?.tools ?? [];

      const registry = new Map();
      for (const tool of toolsList) {
        registry.set(tool.name, tool);
      }

      servers.set(cfg.id, {
        id: cfg.id,
        label: cfg.label,
        hint: cfg.hint,
        client,
        transport,
        tools: registry,
        state: 'connected',
      });

      console.log(
        `[MCP] Connected server "${cfg.label}" (${cfg.transportType}) with ${toolsList.length} tool(s)`
      );
    } catch (error) {
      console.error(
        `[MCP] Failed to connect server "${cfg.label}": ${error?.message || error}`
      );
      servers.set(cfg.id, {
        id: cfg.id,
        label: cfg.label,
        hint: cfg.hint,
        client: null,
        transport: null,
        tools: new Map(),
        state: 'error',
      });
    }
  }

  return getMcpStatus();
}

/**
 * Return the current status of the MCP layer (enabled flag, connected servers,
 * and the flattened list of available tools as { serverId, name, description, inputSchema }).
 */
export function getMcpStatus() {
  const tools = [];
  for (const server of servers.values()) {
    if (!server.client) continue;
    for (const [name, tool] of server.tools.entries()) {
      tools.push({
        serverId: server.id,
        serverLabel: server.label,
        name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || undefined,
      });
    }
  }
  return {
    enabled: env.mcpServersEnabled,
    servers: [...servers.values()].map((s) => ({
      id: s.id,
      label: s.label,
      hint: s.hint,
      state: s.state,
      toolCount: s.tools.size,
    })),
    tools,
  };
}

/**
 * Find a matching MCP tool by name. Falls back to a loose match on the tool
 * name's suffix (e.g. "web_search" matches "search") so flexible connectors
 * work out of the box.
 *
 * @param {string} name - tool name to find
 * @returns {Object|null} { server, tool } or null
 */
export function findMcpTool(name) {
  const lower = String(name || '').toLowerCase();
  for (const server of servers.values()) {
    if (!server.client) continue;
    if (server.tools.has(name)) {
      return { server, tool: server.tools.get(name) };
    }
  }
  // Loose suffix match (e.g. "web_search" -> "search").
  for (const server of servers.values()) {
    if (!server.client) continue;
    for (const [toolName, tool] of server.tools.entries()) {
      if (lower.includes(toolName.toLowerCase()) || toolName.toLowerCase().includes(lower)) {
        return { server, tool };
      }
    }
  }
  return null;
}

/**
 * Helper to interpret a tool name against a hint (search/nutrition).
 * Used by the search/nutrition wrappers to route to the right server.
 */
export function findMcpToolByHint(hint) {
  const target = String(hint || '').toLowerCase();
  for (const server of servers.values()) {
    if (!server.client) continue;
    if (server.hint === target) {
      const first = server.tools.keys().next().value;
      if (first) return { server, tool: server.tools.get(first) };
    }
  }
  // Fallback: any connected server.
  for (const server of servers.values()) {
    if (!server.client || server.tools.size === 0) continue;
    const first = server.tools.keys().next().value;
    return { server, tool: server.tools.get(first) };
  }
  return null;
}

/**
 * Call an MCP tool by name. Returns a string result (text) ready to be placed
 * into a ToolMessage. Never throws: on error it returns a descriptive string.
 *
 * @param {string} name - tool name
 * @param {Object} args - JSON-serializable arguments
 * @param {Object} [opts] - { serverId } optional pin to a specific server
 * @returns {Promise<string>}
 */
export async function callMcpTool(name, args = {}, opts = {}) {
  if (!env.mcpServersEnabled) {
    return `MCP disabled: tool "${name}" not called (MCP_SERVERS_ENABLED=false).`;
  }

  let match = null;
  if (opts.serverId) {
    const server = servers.get(opts.serverId);
    if (server?.client) {
      const tool = server.tools.get(name);
      if (tool) match = { server, tool };
    }
  }
  if (!match) match = findMcpTool(name);

  if (!match) {
    return `Error: MCP tool "${name}" is not available on any connected server.`;
  }

  const { server, tool } = match;
  const timeoutMs = env.mcpToolTimeoutMs;

  try {
    const result = await Promise.race([
      server.client.callTool({ name: tool.name, arguments: args }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP tool "${name}" timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);

    const content = result?.content ?? [];
    const parts = content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text') return c.text;
        if (c?.text) return c.text;
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .filter(Boolean);

    const text = parts.join('\n') || JSON.stringify(result);
    return text;
  } catch (error) {
    return `Error executing MCP tool "${name}": ${error?.message || error}`;
  }
}

/**
 * Close all MCP connections (used on shutdown / tests).
 */
export async function closeMcpClient() {
  for (const server of servers.values()) {
    try {
      await server.client?.close();
    } catch {
      /* ignore */
    }
  }
  servers.clear();
  initialized = false;
}

// Internal helper exported for tests / smoke checks.
export const _internal = { spawn };
