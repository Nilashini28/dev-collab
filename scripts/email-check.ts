import {config,capabilities} from '../apps/api/src/config';
import nodemailer from 'nodemailer';
import {Redis} from 'ioredis';
let failed=false;
function report(ok:boolean,message:string){console.log((ok?'PASS ':'NEEDS SETUP ')+message);if(!ok)failed=true;}
report(config.EMAIL_PROVIDER==='smtp','EMAIL_PROVIDER must be smtp.');
report(config.DEV_INBOX==='false','DEV_INBOX must be false for real invitation delivery.');
report(capabilities.emailMode==='smtp','Use a real SMTP provider, not the development preview or test inbox.');
report(!config.EMAIL_FROM.includes('example.com')&&!config.EMAIL_FROM.includes('example.test'),'EMAIL_FROM must be a sender authorized by your provider.');
const origin=new URL(config.APP_ORIGIN);
report(origin.protocol==='https:'&&!['localhost','127.0.0.1','::1','[::1]'].includes(origin.hostname),'APP_ORIGIN must be the shared HTTPS app origin for remote teammates; reachability must also be tested from another device.');
report(!!config.SMTP_USER===!!config.SMTP_PASSWORD,'Provide both SMTP_USER and SMTP_PASSWORD, or neither for an approved unauthenticated relay.');
if(!failed){
 const smtp=nodemailer.createTransport({host:config.SMTP_HOST,port:config.SMTP_PORT,secure:config.SMTP_SECURE==='true',...(config.SMTP_USER?{auth:{user:config.SMTP_USER,pass:config.SMTP_PASSWORD}}:{}),connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
 try{await smtp.verify();report(true,'SMTP connection and configured authentication verified. No message was sent; sender and recipient acceptance remain unverified.');}catch(e){const code=String((e as any)?.code??'SMTP_ERROR');report(false,/^[A-Z0-9_]+$/.test(code)?'SMTP verification failed ('+code+'). Check provider settings.':'SMTP verification failed. Check provider settings.');}finally{smtp.close();}
}
const redis=new Redis(config.REDIS_URL,{lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:0,retryStrategy:()=>null});redis.on('error',()=>{});
try{await redis.connect();report(await redis.ping()==='PONG','Redis responds; start npm run worker only after reviewing queued invitations.');}catch{report(false,'Redis is unavailable. Start the configured Redis service.');}finally{redis.disconnect();}
console.log('This check does not send emails, process queued invitations or create memberships.');if(failed)process.exitCode=1;
