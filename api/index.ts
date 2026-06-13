/**
 * Vercel deploy entry handler, for serverless deployment, please don't modify this file
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from './app.js';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '8mb',
  },
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}