// src/ai_graph/mcp/calendarTool.js
// Google Calendar MCP tool for the AI agent.
//
// This lets the LangGraph agent create Google Calendar events during chat
// (e.g. "I've added your Leg Day to your calendar for tomorrow at 6 PM").
//
// Requires the Google Calendar MCP server to be configured in MCP_SERVER_COMMANDS:
//   MCP_SERVER_COMMANDS=[{"name":"google-calendar","command":"npx","args":["@googleapis/mcp-server","calendar"]}]
//
// The tool internally calls the MCP server which uses the user's OAuth tokens
// stored in MongoDB to authenticate with Google.

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { callMcpTool, findMcpToolByHint, getMcpStatus } from './mcpClient.js';
import { createEvent } from '../../services/googleCalendarService.js';
import { env } from '../../config/env.js';

/**
 * Parse an ISO8601 string and return { startDateTime, endDateTime } strings
 * that PRESERVE the original timezone offset (e.g. +05:30).
 *
 * Google Calendar API accepts dateTime values with offset strings like
 * "2025-08-11T18:00:00+05:30", so we must NOT convert to UTC via toISOString().
 *
 * @param {string} startTime      - ISO8601 string, possibly with offset e.g. "2025-08-11T18:00:00+05:30"
 * @param {number} durationMinutes
 * @returns {{ startDateTime: string, endDateTime: string, timeZoneOffset: string }}
 */
// Map common UTC offsets to IANA timezone names for the Google Calendar timeZone field.
// Google Calendar API recommends sending BOTH dateTime (with offset) AND timeZone (IANA name).
const OFFSET_TO_IANA = {
  '+05:30': 'Asia/Kolkata',
  '+05:45': 'Asia/Kathmandu',
  '+00:00': 'UTC',
  '-05:00': 'America/New_York',
  '-06:00': 'America/Chicago',
  '-07:00': 'America/Denver',
  '-08:00': 'America/Los_Angeles',
  '+01:00': 'Europe/London',
  '+02:00': 'Europe/Paris',
  '+03:00': 'Europe/Moscow',
  '+05:00': 'Asia/Karachi',
  '+06:00': 'Asia/Dhaka',
  '+07:00': 'Asia/Bangkok',
  '+08:00': 'Asia/Shanghai',
  '+09:00': 'Asia/Tokyo',
  '+09:30': 'Australia/Adelaide',
  '+10:00': 'Australia/Sydney',
};

function buildEventTimes(startTime, durationMinutes) {
  // Extract timezone offset from the startTime string if present (+05:30 / -07:00 / Z)
  const offsetMatch = startTime.match(/([+-]\d{2}:\d{2}|Z)$/);
  const tzOffset = offsetMatch ? offsetMatch[1] : null;

  // Parse to a ms timestamp (respects the offset for correct absolute time)
  const startMs = new Date(startTime).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;

  if (tzOffset && tzOffset !== 'Z') {
    // Re-apply the original offset to both start and end so Google Calendar
    // shows the event at the intended LOCAL time.
    const formatWithOffset = (ms, offset) => {
      const sign = offset[0] === '+' ? 1 : -1;
      const [hh, mm] = offset.slice(1).split(':').map(Number);
      const offsetMs = sign * (hh * 60 + mm) * 60 * 1000;
      const localMs = ms + offsetMs;
      const d = new Date(localMs);
      const pad = (n) => String(n).padStart(2, '0');
      return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
        offset
      );
    };
    // Resolve IANA timezone from offset, fallback to raw offset string
    const ianaTimeZone = OFFSET_TO_IANA[tzOffset] || tzOffset;
    return {
      startDateTime: formatWithOffset(startMs, tzOffset),
      endDateTime: formatWithOffset(endMs, tzOffset),
      timeZoneOffset: tzOffset,
      ianaTimeZone,
    };
  }

  // No offset or Z — fall back to UTC ISO strings
  return {
    startDateTime: new Date(startMs).toISOString(),
    endDateTime: new Date(endMs).toISOString(),
    timeZoneOffset: 'Z',
    ianaTimeZone: 'UTC',
  };
}

/**
 * Create a Google Calendar event for the user.
 * Falls back to direct googleapis call if no calendar MCP server is configured.
 *
 * @param {Object} args
 * @param {string} args.userId      - MongoDB User _id (injected by the agent context)
 * @param {string} args.summary     - Event title, e.g. "Leg Day Workout"
 * @param {string} args.description - Event details
 * @param {string} args.startTime   - ISO8601 datetime string, e.g. "2025-08-11T18:00:00"
 * @param {number} [args.durationMinutes] - Duration in minutes (default 60)
 */
export async function calendarCreateEvent({
  userId,
  summary,
  description = '',
  startTime,
  durationMinutes = 60,
}) {
  if (!env.mcpServersEnabled) {
    // Direct fallback: use googleapis directly via stored OAuth tokens
    if (!userId) {
      return 'Calendar sync disabled (MCP_SERVERS_ENABLED=false) and no userId provided for fallback.';
    }
    try {
      const { startDateTime, endDateTime, ianaTimeZone } = buildEventTimes(startTime, durationMinutes);
      const created = await createEvent(userId, {
        summary,
        description,
        start: { dateTime: startDateTime, timeZone: ianaTimeZone },
        end: { dateTime: endDateTime, timeZone: ianaTimeZone },
      });
      return `Calendar event created: "${created.summary}" on ${startDateTime}. Link: ${created.htmlLink || 'N/A'}`;
    } catch (err) {
      return `Failed to create calendar event: ${err.message}. Make sure the user has connected Google Calendar.`;
    }
  }

  // Try to call a calendar MCP tool if one is registered
  const status = getMcpStatus();
  const calendarMcpTool = status.tools.find((t) =>
    /calendar|event|gcal/i.test(t.name)
  );

  if (calendarMcpTool) {
    const { startDateTime, endDateTime } = buildEventTimes(startTime, durationMinutes);
    return await callMcpTool(calendarMcpTool.name, {
      summary,
      description,
      start: startDateTime,
      end: endDateTime,
    });
  }

  // No MCP calendar server found — fall back to direct googleapis
  if (!userId) {
    return 'No calendar MCP server configured. Add a Google Calendar MCP server or provide userId for fallback.';
  }

  try {
    const { startDateTime, endDateTime, ianaTimeZone } = buildEventTimes(startTime, durationMinutes);
    const eventPayload = {
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: ianaTimeZone },
      end: { dateTime: endDateTime, timeZone: ianaTimeZone },
    };
    console.log('[calendarTool] Sending to Google Calendar API:', JSON.stringify(eventPayload, null, 2));
    const created = await createEvent(userId, eventPayload);
    console.log('[calendarTool] Google response start:', JSON.stringify(created.start));
    return `Calendar event created: "${created.summary}" on ${startDateTime}. Link: ${created.htmlLink || 'N/A'}`;
  } catch (err) {
    return `Failed to create calendar event: ${err.message}. Make sure the user has connected Google Calendar via /aichat settings.`;
  }
}

/**
 * LangChain DynamicStructuredTool for creating Google Calendar events via MCP.
 * The `userId` is injected from the graph context (not exposed to the LLM as a parameter).
 *
 * @param {string} userId - MongoDB User _id from the agent session context
 */
export function createCalendarCreateEventTool(userId) {
  return new DynamicStructuredTool({
    name: 'calendar_create_event',
    description:
      'Add a workout, fitness session, or health activity to the user\'s Google Calendar. ' +
      'Use this when the user confirms a workout plan or asks you to schedule a session on a specific day/time. ' +
      'Always confirm the day, time, and duration with the user before calling this tool.',
    schema: z.object({
      summary: z
        .string()
        .describe("Event title, e.g. 'Leg Day Workout' or 'Morning Run'"),
      description: z
        .string()
        .optional()
        .default('')
        .describe('Optional details such as exercises, sets, reps, or notes'),
      startTime: z
        .string()
        .describe(
          "ISO8601 datetime string for the start of the event, e.g. '2025-08-11T18:00:00'"
        ),
      durationMinutes: z
        .number()
        .optional()
        .default(60)
        .describe('Duration of the event in minutes (default 60)'),
    }),
    func: async ({ summary, description, startTime, durationMinutes }) =>
      calendarCreateEvent({ userId, summary, description, startTime, durationMinutes }),
  });
}
