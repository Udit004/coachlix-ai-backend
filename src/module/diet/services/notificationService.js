import { connectMongo } from '../../../db/mongo.js';

import { getFirebaseAdmin } from '../../../shared/firebaseAdmin.js';
import User from '../../../models/User.js';

export class NotificationService {
  static async sendCustomNotification(token, title, body, data = {}) {
    if (!token) {
      throw new Error('FCM token is required');
    }

    const admin = getFirebaseAdmin();
    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, String(value)])
        ),
        timestamp: Date.now().toString()
      },
      token,
      webpush: {
        fcmOptions: {
          link: data.link || '/dashboard'
        }
      }
    };

    try {
      return await admin.messaging().send(message);
    } catch (error) {
      if (error.code === 'messaging/registration-token-not-registered') {
        try {
          await connectMongo();
          await User.updateMany(
            { pushToken: token },
            { $unset: { pushToken: '' } }
          );
        } catch (cleanupError) {
          console.error('Failed to clean up invalid FCM token:', cleanupError);
        }
      }

      throw error;
    }
  }
}