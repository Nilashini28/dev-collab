import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('.local',{recursive:true});
if(!existsSync('.env')){
  writeFileSync('.env',[
    'NODE_ENV=development','APP_ORIGIN=http://localhost:5173','PORT=3001',
    'DATABASE_URL=postgresql://postgres:devcollab-local@localhost:55432/devcollab',
    'REDIS_URL=redis://localhost:6379',
    'BETTER_AUTH_SECRET='+randomBytes(32).toString('hex'),
    'EMAIL_PAYLOAD_ENCRYPTION_KEY='+randomBytes(32).toString('hex'),
    'EMAIL_PROVIDER=none','DEV_INBOX=true','EMAIL_FROM=DevCollab <team@example.com>',
  ].join('\n')+'\n');
  console.log('Created ignored .env with fresh local secrets. Local preview inbox is enabled on loopback; external email and Google require configuration.');
}else console.log('Existing .env preserved.');
