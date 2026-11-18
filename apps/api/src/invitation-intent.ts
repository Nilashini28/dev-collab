import {createCipheriv,createDecipheriv,randomBytes,hkdfSync} from 'node:crypto';
import type {Request,Response} from 'express';
import {config} from './config';
import {tokenInput} from '../../../packages/contracts';
import {requireThat} from './errors';
type Kind='invite'|'join';
const key=Buffer.from(hkdfSync('sha256',Buffer.from(config.EMAIL_PAYLOAD_ENCRYPTION_KEY,'hex'),Buffer.alloc(0),'invitation-intent',32));
const cookieName=(kind:Kind)=>'devcollab.intent.'+kind;
const cookieOptions={httpOnly:true,sameSite:'lax' as const,secure:config.NODE_ENV==='production',path:'/api'};
export function saveIntent(res:Response,kind:Kind,token:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([cipher.update(JSON.stringify({kind,token,expires:Date.now()+3600000})),cipher.final()]);
 res.cookie(cookieName(kind),Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url'),{...cookieOptions,maxAge:3600000});
}
export function intentToken(req:Request,kind:Kind){
 if(req.body?.token)return tokenInput.parse(req.body).token;
 const value=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(kind)+'='))?.slice(cookieName(kind).length+1);
 let token:string|undefined;
 try{if(value){const bytes=Buffer.from(decodeURIComponent(value),'base64url');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());if(data.kind===kind&&data.expires>Date.now())token=tokenInput.parse(data).token;}}catch{}
 requireThat(token,400,'INVITATION_REQUIRED','Open the complete invitation link again. The pending invitation is missing or expired.');return token;
}
export function clearIntent(res:Response,kind:Kind){res.clearCookie(cookieName(kind),cookieOptions);}
