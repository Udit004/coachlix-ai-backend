import { getFirebaseAdmin } from './firebaseAdmin.js';

export async function verifyUserToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid or missing token');
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();

  if (!cleanToken) {
    throw new Error('Invalid or missing token');
  }

  try {
    const admin = getFirebaseAdmin();
    const decodedToken = await admin.auth().verifyIdToken(cleanToken);

    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name || decodedToken.display_name,
      picture: decodedToken.picture,
      ...decodedToken
    };
  } catch (error) {
    const message = error?.message || 'Token verification failed';
    const wrappedError = new Error(
      error?.code
        ? `Firebase token verification failed (${error.code}): ${message}`
        : `Firebase token verification failed: ${message}`
    );
    wrappedError.code = error?.code;
    throw wrappedError;
  }
}