// src/ai_graph/mcp/searchTool.js
// Internet search tool for the LangGraph agent. NEVER requires an API key or
// MCP server, so it works out of the box on Render, localhost, Vercel, etc.
//
// Search strategy (priority order):
//   1. DuckDuckGo Lite HTML endpoint (free, keyless, real web results).
//   2. Configured MCP search server (optional, for power users).
//
// Registered into both:
//   - createGraphTools()  (so the LLM can request it during tool-calling)
//   - toolRegistry        (so toolsNode.js can execute it at runtime)

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  callMcpTool,
  findMcpToolByHint,
  getMcpStatus,
} from "./mcpClient.js";

const DUCKDUCKGO_LITE = "https://lite.duckduckgo.com/lite/";

/**
 * Search DuckDuckGo's Lite HTML endpoint (no API key required). This returns
 * REAL web results (title + snippet + URL), unlike the Instant Answer API
 * which only answers queries with a dedicated knowledge entry. Works from a
 * server (Render/localhost) without any key.
 * @param {string} query - search query
 * @param {number} maxResults - max results to return (default 5)
 * @returns {Promise<string>} formatted results or a clear error string
 */
async function duckDuckGoSearch(query, maxResults) {
  const body = new URLSearchParams({ q: query });

  let res;
  try {
    res = await fetch(DUCKDUCKGO_LITE, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(env.mcpToolTimeoutMs || 10000),
    });
  } catch (err) {
    return `Internet search error: could not reach DuckDuckGo (${err?.message || err}). Try again later.`;
  }

  if (!res.ok) {
    return `Internet search error: DuckDuckGo returned HTTP ${res.status}.`;
  }

  let html;
  try {
    html = await res.text();
  } catch {
    return `Internet search error: could not read DuckDuckGo response.`;
  }

  // Parse the Lite HTML results: each result is an <a class='result-link'>
  // (single quotes) containing the URL and title, followed by a snippet <td>.
  const results = [];
  // In DuckDuckGo Lite HTML the <a> tag has href BEFORE class:
  //   <a rel="nofollow" href="URL" class='result-link'>TITLE</a>
  // Match href, then the class anywhere after it.
  const linkPattern =
    /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = linkPattern.exec(html)) && results.length < (Number(maxResults) || 5)) {
    const url = decodeHtml(m[1]);
    const title = decodeHtml(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    results.push({ title, url });
  }

  const snippets = [];
  const snippetPattern = /<td[^>]*class=['"]result-snippet['"][^>]*>(.*?)<\/td>/gis;
  let sm;
  while ((sm = snippetPattern.exec(html)) && snippets.length < results.length) {
    snippets.push(decodeHtml(sm[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  }

  if (results.length === 0) {
    if (/no results/i.test(html)) {
      return `No web results found for "${query}".`;
    }
    return `Internet search error: could not parse results from DuckDuckGo.`;
  }

  const lines = [];
  results.forEach((r, i) => {
    lines.push(`• ${r.title}\n  ${snippets[i] || ""}\n  ${r.url}`);
  });
  return lines.join("\n");
}

/** Minimal HTML entity decoder. */
function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Execute a web search. Prefers a configured MCP search server if one is
 * connected; otherwise falls back to the keyless DuckDuckGo Lite endpoint.
 * This means search ALWAYS works even when no MCP server / API key is
 * configured.
 */
export async function webSearch({ query, maxResults = 5 }) {
  const queryStr = String(query || "").trim();

  if (!queryStr) {
    return `Error: web_search requires a non-empty "query".`;
  }

  // 1) If an MCP search server is connected, use it (power users).
  if (env.mcpServersEnabled) {
    try {
      const status = getMcpStatus();
      const named = status.tools.find((t) =>
        /search|web|brave|tavily|google/i.test(t.name)
      );
      if (named) {
        const r = await callMcpTool(named.name, { query: queryStr, maxResults });
        if (!/error/i.test(r)) return r;
      } else {
        const byHint = findMcpToolByHint("search");
        if (byHint) {
          const r = await callMcpTool(byHint.tool.name, {
            query: queryStr,
            maxResults,
          });
          if (!/error/i.test(r)) return r;
        }
      }
    } catch (err) {
      console.warn(`[web_search] MCP search failed, falling back to DuckDuckGo: ${err?.message}`);
    }
  }

  // 2) Always-available keyless fallback (works on Render, no config needed).
  return duckDuckGoSearch(queryStr, maxResults);
}

/**
 * LangChain DynamicStructuredTool so the LLM can call web_search during
 * tool-calling. Uses a flat schema (compatible with Groq/OpenRouter/Gemini).
 */
export function createMcpWebSearchTool() {
  return new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the live internet for current, up-to-date fitness, nutrition, workout, sports-science, " +
      "research, or general knowledge that may be outside the model's training cutoff. " +
      "Use this when the user asks about recent news, current studies, specific athletes, live schedules, " +
      "latest recommendations, or anything requiring up-to-date information. " +
      "Provides ranked results with titles, snippets, and URLs. No API key required.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The search query in natural language (concise, standalone, e.g. 'best chest exercises 2025' or 'protein intake for muscle gain')"
        ),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (1-10)"),
    }),
    func: async ({ query, maxResults }) => webSearch({ query, maxResults }),
  });
}

