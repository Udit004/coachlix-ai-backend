// src/module/calendar/oauthController.js
import { google } from 'googleapis';
import User from '../../models/User.js';
import { env } from '../../config/env.js';
import { verifyUserToken } from '../../shared/auth.js';

/**
 * Registers Google Calendar OAuth endpoints.
 *   GET /calendar/oauth/url      -> returns a Google consent URL.
 *   GET /calendar/oauth/callback -> receives Google auth code, stores tokens,
 *                                   and redirects the user to the AI chat page.
 */
export async function registerOAuthController(fastify) {
  // ---------------------------------------------------------------
  // 1️⃣ Generate Google consent URL
  // ---------------------------------------------------------------
  fastify.get('/oauth/url', async (req, reply) => {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader) {
      return reply.code(401).send({ error: 'Authorization header missing' });
    }

    let user;
    try {
      user = await verifyUserToken(authHeader);
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthenticated', message: err.message });
    }

    const userId = user.uid;

    const oauth2Client = new google.auth.OAuth2(
      env.googleClientId,
      env.googleClientSecret,
      env.googleRedirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      prompt: 'consent',
      state: userId, // pass Firebase UID through the OAuth flow
    });

    return reply.send({ url: authUrl });
  });

  // ---------------------------------------------------------------
  // 2️⃣ Callback – Google redirects here with ?code=…&state=…
  // ---------------------------------------------------------------
  fastify.get('/oauth/callback', async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state) {
      return reply.code(400).send({ error: 'Missing code or state' });
    }

    const oauth2Client = new google.auth.OAuth2(
      env.googleClientId,
      env.googleClientSecret,
      env.googleRedirectUri
    );

    try {
      const { tokens } = await oauth2Client.getToken(code);

      // Find the user by the Firebase UID we stored in `state`
      const user = await User.findOne({ firebaseUid: state });
      if (!user) return reply.code(404).send({ error: 'User not found' });

      // Persist tokens – refresh_token may be undefined on subsequent consents
      user.accessToken = tokens.access_token;
      if (tokens.refresh_token) user.refreshToken = tokens.refresh_token;
      user.tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
      user.calendarSyncEnabled = true;
      await user.save();

      // Redirect to AI chat page (frontend).
      const chatRedirect = `${env.frontendBaseUrl}/ai-chat`;
      return reply.redirect(chatRedirect);
    } catch (err) {
      req.log.error('OAuth callback error:', err);
      return reply.redirect(`${env.frontendBaseUrl}/ai-chat?calendar_error=1`);
    }
  });
}
