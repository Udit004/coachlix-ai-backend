// src/services/googleCalendarService.js
import { google } from 'googleapis';
import User from '../models/User.js';
import { env } from '../config/env.js';

/**
 * Initialize an OAuth2 client for a given user.
 * Retrieves stored tokens from the User document and refreshes them if needed.
 */
async function initClient(userId) {
  // Determine if userId is a MongoDB ObjectId; if not, treat it as Firebase UID
  let query = {};
  const { Types } = await import('mongoose');
  if (Types.ObjectId.isValid(userId)) {
    query = { _id: userId };
  } else {
    query = { firebaseUid: userId };
  }
  const user = await User.findOne(query).select('accessToken refreshToken tokenExpiry');
  if (!user || !user.accessToken || !user.refreshToken) {
    throw new Error('Google OAuth tokens not configured for user');
  }

  const oauth2Client = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    expiry_date: user.tokenExpiry ? user.tokenExpiry.getTime() : undefined,
  });

  // Refresh if expired
  if (user.tokenExpiry && new Date() >= user.tokenExpiry) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const { access_token, refresh_token, expiry_date } = credentials;
    // Update stored tokens
    user.accessToken = access_token;
    if (refresh_token) user.refreshToken = refresh_token;
    if (expiry_date) user.tokenExpiry = new Date(expiry_date);
    await user.save();
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}

/**
 * Create a calendar event for the user.
 * `event` should contain { summary, description, start, end } matching Google Calendar API.
 */
export async function createEvent(userId, event) {
  const auth = await initClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });
  return res.data;
}

/** Optional: revoke access when user disables sync */
export async function revokeAccess(userId) {
  const auth = await initClient(userId);
  await auth.revokeCredentials();
  // Use same query logic as initClient to support firebaseUid
  const { Types } = await import('mongoose');
  let query = Types.ObjectId.isValid(userId) ? { _id: userId } : { firebaseUid: userId };
  await User.findOneAndUpdate(query, {
    accessToken: null,
    refreshToken: null,
    tokenExpiry: null,
    calendarSyncEnabled: false,
  });
}
