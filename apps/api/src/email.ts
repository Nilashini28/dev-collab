import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config, capabilities } from './config';
import { db } from '../../../packages/db';
import { AppError } from './errors';
export type Mail = { to: string; subject: string; text: string };
export function encrypt(mail: Mail) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.EMAIL_PAYLOAD_ENCRYPTION_KEY, 'hex'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(mail)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decrypt(value: string): Mail {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(config.EMAIL_PAYLOAD_ENCRYPTION_KEY, 'hex'), data.subarray(0,12));
  cipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}
export async function queueAuthMail(mail: Mail) {
  if (!capabilities.email) throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured.');
  await db.$transaction(async tx => {
    const delivery = await tx.emailDelivery.create({ data: { encryptedPayload: encrypt(mail), expiresAt: new Date(Date.now()+60*60*1000) } });
    await tx.outboxEvent.create({ data: { type: 'email.queued', entityId: delivery.id } });
  });
}
