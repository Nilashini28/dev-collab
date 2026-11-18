import {emailMode} from './email-mode';
import 'dotenv/config';
import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('127.0.0.1'),
  BETTER_AUTH_SECRET: z.string().min(32),
  EMAIL_PAYLOAD_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  EMAIL_PROVIDER: z.enum(['none', 'smtp', 'resend']).default('none'),
  DEV_INBOX: z.enum(['true','false']).default('false'),
  EMAIL_FROM: z.string().default('DevCollab <team@example.com>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.string().default('false'),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
}).parse(process.env);
if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) throw new Error('Production requires HTTPS.');
export const capabilities = {
  email: (config.NODE_ENV==='development'&&config.HOST==='127.0.0.1'&&config.DEV_INBOX==='true') || config.EMAIL_PROVIDER === 'smtp' || (config.EMAIL_PROVIDER === 'resend' && !!config.RESEND_API_KEY),
  google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  emailMode: emailMode(config),
};
