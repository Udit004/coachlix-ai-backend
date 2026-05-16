import { v2 as cloudinary } from 'cloudinary';

import { env } from '../config/env.js';

let configured = false;

export function getCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: env.cloudName,
      api_key: env.cloudApiKey,
      api_secret: env.cloudApiSecret
    });

    configured = true;
  }

  return cloudinary;
}