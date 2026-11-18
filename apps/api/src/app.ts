import {traceability} from './traceability';
import {knowledge} from './knowledge';
import {ai} from './ai';
import {readiness} from './readiness';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { z, ZodError } from 'zod';
import { auth } from './auth';
import { config, capabilities } from './config';
import { AppError, requireThat } from './errors';
import { db } from '../../../packages/db';
import * as schema from '../../../packages/contracts';
import * as service from './workspaces';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { planning } from './planning';
import {chat} from './chat';
import {github,githubWebhook} from './github';
import {decrypt} from './email';
import {saveIntent,intentToken,clearIntent} from './invitation-intent';
export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false, referrerPolicy:{policy:'no-referrer'} }));
app.use('/api/webhooks/github',githubWebhook);
app.use((req,res,next) => {
  res.locals.requestId=randomUUID();
  res.setHeader('X-Request-Id',res.locals.requestId);
  if(req.path.startsWith('/api'))res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== config.APP_ORIGIN) {
    return next(new AppError(403,'ORIGIN_REJECTED','Request origin is not allowed.'));
  }
  next();
});
app.get('/health/live',(_req,res)=>res.json({status:'ok'}));
app.get('/health/ready',async (_req,res,next)=>{
  try { await db.$queryRaw`SELECT 1`; res.json({status:'ready'}); }
  catch {next(new AppError(503,'NOT_READY','Database is unavailable.'));}
});
app.get('/api/v1/capabilities',(_req,res)=>res.json({data:capabilities}));
app.post('/api/invitation-intent',rateLimit({windowMs:60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false}),express.json({limit:'2kb'}),(req,res)=>{
  const body=schema.tokenInput.extend({kind:z.enum(['invite','join'])}).parse(req.body);saveIntent(res,body.kind,body.token);res.json({data:{stored:true}});
});
app.post('/api/dev/inbox',rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),express.json({limit:'2kb'}),async(req,res)=>{
  requireThat(capabilities.emailMode==='local-preview'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip??''),404,'NOT_FOUND','Not found.');
  const {email}=z.object({email:z.email()}).parse(req.body);let result:{url:string;subject:string}|null=null;
  const deliveries=await db.emailDelivery.findMany({where:{encryptedPayload:{not:null},state:'QUEUED'},orderBy:{createdAt:'desc'},take:100});
  for(const delivery of deliveries){const mail=decrypt(delivery.encryptedPayload!);if(mail.to.toLowerCase()===email.toLowerCase()){const url=mail.text.match(/https?:\/\/[^\s]+/)?.[0];if(url&&new URL(url).origin===config.APP_ORIGIN){result={url,subject:mail.subject};break;}}}
  res.json({data:result});
});
app.use('/api/auth',rateLimit({windowMs:60000,limit:30,skip:()=>config.NODE_ENV==='test',standardHeaders:'draft-8',legacyHeaders:false}));
app.use('/api/auth',(req,_res,next)=>{
  const needsMail=['/sign-up/email','/request-password-reset','/send-verification-email'];
  if(needsMail.includes(req.path) && !capabilities.email)return next(new AppError(503,'EMAIL_UNAVAILABLE','Email delivery is not configured. Registration and email recovery are unavailable.'));
  next();
});
app.all('/api/auth/*splat',toNodeHandler(auth));
// AI approvals may include a bounded wiki draft plus reviewed task descriptions.
app.use('/api/v1/ai',express.json({limit:'160kb'}));
app.use(express.json({limit:'32kb'}));
// Shared networks need separate authenticated-user budgets. Keep an outer IP guard.
app.use('/api/v1',rateLimit({windowMs:60000,limit:1000,standardHeaders:'draft-8',legacyHeaders:false}));
app.use('/api/v1',async(req,res,next)=>{
  try {
    const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
    requireThat(session,401,'UNAUTHENTICATED','Sign in to continue.');
    res.locals.actor=session.user;
    if(req.path !== '/me')requireThat(session.user.emailVerified,403,'EMAIL_UNVERIFIED','Verify your email before joining a workspace.');
    next();
  }catch(error){next(error);}
});
app.use('/api/v1',rateLimit({windowMs:60000,limit:180,keyGenerator:(_req,res)=>res.locals.actor.id,standardHeaders:'draft-8',legacyHeaders:false}));
app.get('/api/v1/me',(_req,res)=>res.json({data:res.locals.actor}));
const api=express.Router();
const actor=(res:express.Response)=>res.locals.actor as service.Actor;
const id=(req:express.Request,key:string)=>z.string().min(1).max(128).parse(req.params[key]);
const page=(req:express.Request)=>{
  const input=z.object({cursor:z.string().max(128).optional(),limit:z.coerce.number().int().min(1).max(100).default(25)}).parse(req.query);
  return {take:input.limit+1,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{}),orderBy:[{createdAt:'asc' as const},{id:'asc' as const}]};
};
function list(res:express.Response,rows:Array<{id:string}>,limit=25){
  const more=rows.length>limit;const items=more?rows.slice(0,limit):rows;
  res.json({items,nextCursor:more?items.at(-1)!.id:null});
}
const limit=(req:express.Request)=>Number(req.query.limit??25);
api.get('/workspaces',async(req,res)=>{
  const rows=await db.membership.findMany({where:{userId:actor(res).id,active:true},include:{workspace:true},...page(req)});
  list(res,rows.map(m=>({...m.workspace,id:m.id,workspaceId:m.workspaceId,role:m.role})),limit(req));
});
api.post('/workspaces',async(req,res)=>res.status(201).json({data:await service.createWorkspace(actor(res),schema.workspaceInput.parse(req.body).name)}));
api.get('/workspaces/:w',async(req,res)=>{
  const m=await service.membership(db,id(req,'w'),actor(res).id);
  const workspace=await db.workspace.findUniqueOrThrow({where:{id:m.workspaceId}});
  const count=await db.membership.count({where:{workspaceId:m.workspaceId,active:true}});
  res.json({data:{...workspace,role:m.role,memberCount:count}});
});
api.get('/workspaces/:w/members',async(req,res)=>{
  const w=id(req,'w');await service.membership(db,w,actor(res).id);
  const rows=await db.membership.findMany({where:{workspaceId:w,active:true},include:{user:{select:{id:true,name:true,email:true,emailVerified:true}}},...page(req)});
  list(res,rows,limit(req));
});
api.patch('/workspaces/:w/members/:u',async(req,res)=>{
  const body=schema.memberInput.parse(req.body);
  res.json({data:await service.changeMember(actor(res),id(req,'w'),id(req,'u'),body.expectedVersion,body.role)});
});
api.delete('/workspaces/:w/members/:u',async(req,res)=>{
  res.json({data:await service.changeMember(actor(res),id(req,'w'),id(req,'u'),schema.versionInput.parse(req.body).expectedVersion)});
});
api.post('/workspaces/:w/ownership-transfer',async(req,res)=>{
  const body=schema.transferInput.parse(req.body);
  res.json({data:await service.transfer(actor(res),id(req,'w'),body.targetUserId,body.expectedVersion)});
});
api.post('/workspaces/:w/invitations',async(req,res)=>{
  const body=schema.invitationInput.parse(req.body);
  res.status(201).json({data:await service.invite(actor(res),id(req,'w'),body.emails,body.role)});
});
api.post('/workspaces/:w/invitation-deliveries',async(req,res)=>{
 const w=id(req,'w');await service.membership(db,w,actor(res).id,true);
 const {ids}=z.object({ids:z.array(z.string().uuid()).min(1).max(20)}).parse(req.body);
 const invitations=await db.invitation.findMany({where:{workspaceId:w,id:{in:ids}},select:{id:true,deliveries:{orderBy:{createdAt:'desc'},take:1,select:{state:true,errorCode:true}}}});
 res.json({items:invitations.map(i=>({id:i.id,state:i.deliveries[0]?.state??'UNAVAILABLE',errorCode:i.deliveries[0]?.errorCode??null}))});
});
api.get('/workspaces/:w/invitations',async(req,res)=>{
  const w=id(req,'w');await service.membership(db,w,actor(res).id,true);
  const rows=await db.invitation.findMany({where:{workspaceId:w},select:{
    id:true,email:true,role:true,expiresAt:true,acceptedAt:true,revokedAt:true,createdAt:true,
    deliveries:{select:{id:true,state:true,errorCode:true,createdAt:true},orderBy:{createdAt:'desc'},take:1},
  },...page(req)});
  list(res,rows.map(i=>({...i,state:i.acceptedAt?'ACCEPTED':i.revokedAt?'REVOKED':i.expiresAt.getTime()<Date.now()?'EXPIRED':'PENDING'})),limit(req));
});
api.post('/workspaces/:w/invitations/:i/resend',async(req,res)=>res.json({data:await service.updateInvite(actor(res),id(req,'w'),id(req,'i'),true)}));
api.delete('/workspaces/:w/invitations/:i',async(req,res)=>res.json({data:await service.updateInvite(actor(res),id(req,'w'),id(req,'i'),false)}));
api.post('/invitations/accept',async(req,res)=>{const data=await service.acceptInvite(actor(res),intentToken(req,'invite'));clearIntent(res,'invite');res.json({data});});
api.post('/invitations/preview',async(req,res)=>{
  const raw=intentToken(req,'invite');
  const i=await db.invitation.findUnique({where:{tokenHash:service.hash(raw)},select:{workspace:{select:{name:true}},email:true,role:true,expiresAt:true,revokedAt:true,acceptedAt:true}});
  requireThat(i,404,'NOT_FOUND','Invitation not found.');
  requireThat(i.email.toLowerCase()===actor(res).email.toLowerCase(),403,'EMAIL_MISMATCH','Sign in with the verified email address that received this invitation.');
  res.json({data:{workspaceName:i.workspace.name,role:i.role,expiresAt:i.expiresAt,state:i.revokedAt?'REVOKED':i.acceptedAt?'ACCEPTED':i.expiresAt.getTime()<Date.now()?'EXPIRED':'PENDING'}});
});
api.post('/join-links/preview',async(req,res)=>{
  const raw=intentToken(req,'join');
  const link=await db.joinLink.findUnique({where:{tokenHash:service.hash(raw)},include:{workspace:{select:{name:true}}}});
  requireThat(link,404,'INVALID_LINK','Join link not found.');
  const member=await db.membership.findUnique({where:{workspaceId_userId:{workspaceId:link.workspaceId,userId:actor(res).id}}});
  res.json({data:{workspaceName:link.workspace.name,role:'MEMBER',expiresAt:link.expiresAt,requiresApproval:link.requiresApproval,state:member?.active?'ACCEPTED':link.revokedAt?'REVOKED':link.expiresAt.getTime()<Date.now()?'EXPIRED':link.uses>=link.maxUses?'FULL':'PENDING'}});
});
api.get('/workspaces/:w/join-links',async(req,res)=>{
  const w=id(req,'w');await service.membership(db,w,actor(res).id,true);
  const rows=await db.joinLink.findMany({where:{workspaceId:w},select:{id:true,expiresAt:true,revokedAt:true,maxUses:true,uses:true,requiresApproval:true,createdAt:true},...page(req)});
  list(res,rows,limit(req));
});
api.post('/workspaces/:w/join-links',async(req,res)=>res.status(201).json({data:await service.createLink(actor(res),id(req,'w'),schema.linkInput.parse(req.body))}));
api.delete('/workspaces/:w/join-links/:i',async(req,res)=>res.json({data:await service.revokeLink(actor(res),id(req,'w'),id(req,'i'))}));
api.post('/join-links/accept',async(req,res)=>{const data=await service.acceptLink(actor(res),intentToken(req,'join'));if(data.state!=='PENDING')clearIntent(res,'join');res.json({data});});
api.get('/workspaces/:w/join-requests',async(req,res)=>{
  const w=id(req,'w');await service.membership(db,w,actor(res).id,true);
  const rows=await db.joinRequest.findMany({where:{link:{workspaceId:w},state:'PENDING'},select:{id:true,version:true,createdAt:true,user:{select:{id:true,name:true,email:true}}},...page(req)});
  list(res,rows,limit(req));
});
api.post('/workspaces/:w/join-requests/:i/decision',async(req,res)=>{
  const body=schema.decisionInput.parse(req.body);
  res.json({data:await service.decide(actor(res),id(req,'w'),id(req,'i'),body.decision,body.expectedVersion)});
});
app.use('/api/v1',api);
app.use('/api/v1',planning);
app.use('/api/v1',chat);
app.use('/api/v1',github);
app.use('/api/v1',knowledge);
app.use('/api/v1',ai);
app.use('/api/v1',readiness);
app.use('/api/v1',traceability);
app.use('/api',(_req,_res,next)=>next(new AppError(404,'NOT_FOUND','Endpoint not found.')));
const web=resolve('dist/web');
if(existsSync(web)){
  app.use(express.static(web));
  app.get('/{*splat}',(_req,res)=>res.sendFile('index.html',{root:web}));
}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const requestId=res.locals.requestId;
  if(error instanceof Error&&error.name==='MulterError')return res.status(422).json({error:{code:'UPLOAD_LIMIT',message:'Upload one PDF, DOCX or TXT file up to 5 MB.',requestId}});
  if(error instanceof ZodError)return res.status(422).json({error:{code:'VALIDATION',message:error.issues.map(issue=>issue.message).slice(0,3).join(' '),fieldErrors:error.flatten().fieldErrors,requestId}});
  if(error instanceof AppError)return res.status(error.status).json({error:{code:error.code,message:error.message,requestId}});
  if(error && typeof error==='object' && 'code' in error && error.code==='P2002')return res.status(409).json({error:{code:'CONFLICT',message:'This record already exists.',requestId}});
  console.error(JSON.stringify({level:'error',requestId,event:'request.failed'}));
  res.status(500).json({error:{code:'INTERNAL',message:'Unable to complete this request. Try again.',requestId}});
});

