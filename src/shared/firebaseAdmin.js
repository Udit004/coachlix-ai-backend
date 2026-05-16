import admin from 'firebase-admin';

import { env } from '../config/env.js';

let serviceAccount = null;
let adminInstance = null;

function parseServiceAccount() {
  if (serviceAccount) {
    return serviceAccount;
  }

  try {
    if (
      env.firebaseAdminProjectId &&
      env.firebaseAdminPrivateKey &&
      env.firebaseAdminClientEmail
    ) {
      serviceAccount = {
        type: 'service_account',
        project_id: env.firebaseAdminProjectId,
        private_key: env.firebaseAdminPrivateKey.replace(/\\n/g, '\n'),
        client_email: env.firebaseAdminClientEmail
      };
    } else if (env.firebaseAdminCredentialsBase64) {
      const jsonString = Buffer.from(env.firebaseAdminCredentialsBase64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(jsonString);
    } else if (env.firebaseAdminCredentials) {
      serviceAccount = JSON.parse(env.firebaseAdminCredentials);
    } else {
      throw new Error('No Firebase Admin credentials found');
    }

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    return serviceAccount;
  } catch (error) {
    throw new Error(`Invalid Firebase Admin credentials: ${error.message}`);
  }
}

export function getFirebaseAdmin() {
  if (adminInstance) {
    return adminInstance;
  }

  const credentials = parseServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
      projectId: credentials.project_id
    });
  }

  adminInstance = admin;
  return adminInstance;
}