import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '../../../packages/db';
import { config, capabilities } from './config';
import { queueAuthMail } from './email';
import {createAuthMiddleware,APIError} from 'better-auth/api';
import {z} from 'zod';
export const auth = betterAuth({
  appName: 'DevCollab',
  baseURL: config.APP_ORIGIN,
  secret: config.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: 'postgresql' }),
  trustedOrigins: [config.APP_ORIGIN],
  hooks:{before:createAuthMiddleware(async ctx=>{
    if(ctx.path==='/sign-up/email'){
      const result=z.object({name:z.string().trim().min(2).max(80),email:z.email(),password:z.string().min(12).max(128)}).safeParse(ctx.body);
      if(!result.success)throw new APIError('BAD_REQUEST',{message:'Enter a name of 2–80 characters, a valid email and a password of 12–128 characters.'});
      ctx.body.name=result.data.name;
    }
  })},
  emailAndPassword: {
    enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({user,url}) => queueAuthMail({ to: user.email, subject: 'Reset your DevCollab password', text: 'Reset your DevCollab password using this link: '+url }),
  },
  emailVerification: {
    sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: true, expiresIn: 3600,
    sendVerificationEmail: async ({user,url}) => queueAuthMail({ to: user.email, subject: 'Verify your DevCollab email', text: 'Verify your email to join your team: '+url }),
  },
  socialProviders: capabilities.google ? { google: { clientId: config.GOOGLE_CLIENT_ID!, clientSecret: config.GOOGLE_CLIENT_SECRET! } } : {},
  account: { accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false, trustedProviders: [] } },
  session: { expiresIn: 60*60*24*7, updateAge: 60*60, cookieCache: { enabled: false } },
  rateLimit: { enabled: config.NODE_ENV !== 'test', storage: 'memory', window: 60, max: 30 },
  advanced: { useSecureCookies: config.NODE_ENV === 'production' },
  onAPIError: { errorURL: config.APP_ORIGIN+'/login' },
  logger: { level: 'error' },
});
