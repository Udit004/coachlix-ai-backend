import { connectMongo } from '../../../db/mongo.js';

import { getFirebaseAdmin } from '../../../shared/firebaseAdmin.js';
import User from '../../../models/User.js';

export class NotificationService {
  static async sendCustomNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) {
      throw new Error('At least one FCM token is required');
    }

    const admin = getFirebaseAdmin();
    const message = {
      data: {
        title: String(title),
        body: String(body),
        ...Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, String(value)])
        ),
        timestamp: Date.now().toString()
      },
      tokens: Array.isArray(tokens) ? tokens : [tokens],
      webpush: {
        fcmOptions: {
          link: data.link || '/dashboard'
        }
      }
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      
      // Handle invalid tokens to clean up database
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered'
            ) {
              failedTokens.push(message.tokens[idx]);
            }
          }
        });

        if (failedTokens.length > 0) {
          try {
            await connectMongo();
            await User.updateMany(
              { pushTokens: { $in: failedTokens } },
              { $pullAll: { pushTokens: failedTokens } }
            );
          } catch (cleanupError) {
            console.error('Failed to clean up invalid FCM tokens:', cleanupError);
          }
        }
      }

      return response;
    } catch (error) {
      console.error('Multicast error:', error);
      throw error;
    }
  }
}