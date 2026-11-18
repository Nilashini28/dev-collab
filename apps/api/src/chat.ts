import {Router} from 'express';
import {z} from 'zod';
import {db} from '../../../packages/db';
import type {Prisma} from '../../../packages/db/generated/client';
import {membership,type Actor} from './workspaces';
import {requireThat} from './errors';
import {projectScope} from './planning';
export const chat=Router();
export async function conversationScope(tx:Prisma.TransactionClient,id:string,actor:Actor,write=false){
 const conversation=await tx.conversation.findUnique({where:{id},include:{participants:true}});
 requireThat(conversation,404,'NOT_FOUND','Conversation not found.');
 const member=await membership(tx,conversation.workspaceId,actor.id);
 if(conversation.projectId)await projectScope(tx,conversation.projectId,actor);
 requireThat(conversation.kind!=='DM'||conversation.participants.some(p=>p.userId===actor.id),404,'NOT_FOUND','Conversation not found.');
 requireThat(!write||member.role!=='VIEWER',403,'READ_ONLY','Viewers cannot send messages.');
 if(conversation.kind==='DM')for(const participant of conversation.participants)await membership(tx,conversation.workspaceId,participant.userId);
 return conversation;
}
export async function unreadChat(w:string,userId:string){
 return db.$queryRaw<Array<{id:string;unread:bigint}>>`SELECT c.id, COUNT(m.id)::bigint AS unread FROM "Conversation" c
 LEFT JOIN "ReadCursor" r ON r."conversationId"=c.id AND r."userId"=${userId}
 LEFT JOIN "Message" m ON m."conversationId"=c.id AND m.sequence>COALESCE(r.sequence,0) AND m."senderId"<>${userId}
 LEFT JOIN "Project" p ON p.id=c."projectId" LEFT JOIN "Hackathon" h ON h.id=p."hackathonId"
 WHERE c."workspaceId"=${w} AND (c."projectId" IS NULL OR h."archivedAt" IS NULL)
 AND (c.kind<>'DM' OR (EXISTS(SELECT 1 FROM "ConversationParticipant" cp WHERE cp."conversationId"=c.id AND cp."userId"=${userId})
 AND NOT EXISTS(SELECT 1 FROM "ConversationParticipant" cp WHERE cp."conversationId"=c.id AND NOT EXISTS(SELECT 1 FROM "Membership" mm WHERE mm."workspaceId"=${w} AND mm."userId"=cp."userId" AND mm.active=true)))) GROUP BY c.id`;
}
chat.get('/workspaces/:w/chat-summary',async(req,res)=>{
 const w=String(req.params.w);await membership(db,w,res.locals.actor.id);const rows=await unreadChat(w,res.locals.actor.id);
 res.json({data:{unread:rows.reduce((total,row)=>total+Number(row.unread),0),conversations:rows.map(row=>({id:row.id,unread:Number(row.unread)}))}});
});
chat.get('/workspaces/:w/conversations',async(req,res)=>{
 const w=String(req.params.w),actor=res.locals.actor as Actor;await membership(db,w,actor.id);
 const unread=new Map((await unreadChat(w,actor.id)).map(row=>[row.id,Number(row.unread)]));
 const input=z.object({cursor:z.string().optional()}).parse(req.query);
 const items=await db.conversation.findMany({where:{workspaceId:w,id:{in:[...unread.keys()]}},include:{participants:{include:{user:{select:{id:true,name:true}}}},reads:{where:{userId:actor.id}}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:51,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 res.json({items:items.slice(0,50).map(c=>({...c,unread:unread.get(c.id)??0})),nextCursor:items.length>50?items[49].id:null});
});
chat.post('/workspaces/:w/conversations',async(req,res)=>{
 const w=String(req.params.w),actor=res.locals.actor as Actor;
 const body=z.object({kind:z.enum(['GROUP','PROJECT','DM']),projectId:z.string().optional(),peerId:z.string().optional()}).parse(req.body);
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w} FOR UPDATE`;
  const member=await membership(tx,w,actor.id);requireThat(member.role!=='VIEWER',403,'READ_ONLY','Viewers cannot create conversations.');
  let scopeKey='workspace:'+w,name='Team conversation',projectId:string|undefined;
  if(body.kind==='PROJECT'){
   requireThat(body.projectId,422,'PROJECT_REQUIRED','Select a project.');
   const project=await projectScope(tx,body.projectId,actor);requireThat(project.hackathon.workspaceId===w,404,'NOT_FOUND','Project not found.');
   projectId=project.id;scopeKey='project:'+project.id;name=project.name;
  }
  if(body.kind==='DM'){
   requireThat(body.peerId&&body.peerId!==actor.id,422,'PEER_REQUIRED','Choose another teammate.');
   await membership(tx,w,body.peerId);scopeKey='dm:'+w+':'+[actor.id,body.peerId].sort().join(':');name='Direct message';
  }
  return tx.conversation.upsert({where:{scopeKey},create:{workspaceId:w,projectId,kind:body.kind,name,scopeKey,...(body.kind==='DM'?{participants:{create:[{userId:actor.id},{userId:body.peerId!}]}}:{})},update:{}});
 });res.status(201).json({data:result});
});
chat.get('/conversations/:c/messages',async(req,res)=>{
 const c=String(req.params.c);await conversationScope(db,c,res.locals.actor);
 const input=z.object({before:z.coerce.number().int().positive().optional(),after:z.coerce.number().int().nonnegative().optional()}).parse(req.query);
 requireThat(!(input.before&&input.after),422,'INVALID_CURSOR','Use before or after, not both.');
 const items=await db.message.findMany({where:{conversationId:c,...(input.before?{sequence:{lt:input.before}}:input.after!==undefined?{sequence:{gt:input.after}}:{})},orderBy:{sequence:input.after!==undefined?'asc':'desc'},take:51});
 const page=items.slice(0,50);res.json({items:input.after!==undefined?page:page.reverse(),hasMore:items.length>50});
});
chat.post('/conversations/:c/messages',async(req,res)=>{
 const c=String(req.params.c),actor=res.locals.actor as Actor,body=z.object({body:z.string().trim().min(1).max(6000),clientMessageId:z.uuid()}).parse(req.body);
 const result=await db.$transaction(async tx=>{
  const initial=await conversationScope(tx,c,actor,true);
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${initial.workspaceId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${c} FOR UPDATE`;
  await conversationScope(tx,c,actor,true);
  const existing=await tx.message.findUnique({where:{conversationId_senderId_clientMessageId:{conversationId:c,senderId:actor.id,clientMessageId:body.clientMessageId}}});
  if(existing){requireThat(existing.body===body.body,409,'IDEMPOTENCY_CONFLICT','This message ID was already used for different text.');return existing;}
  const conversation=await tx.conversation.update({where:{id:c},data:{nextSequence:{increment:1}}});
  const message=await tx.message.create({data:{conversationId:c,senderId:actor.id,authorName:actor.name,sequence:conversation.nextSequence-1,...body}});
  await tx.outboxEvent.create({data:{type:'message.created',entityId:message.id}});return message;
 });res.status(201).json({data:result});
});
chat.post('/conversations/:c/read',async(req,res)=>{
 const c=String(req.params.c),actor=res.locals.actor as Actor;
 const {sequence}=z.object({sequence:z.number().int().nonnegative()}).parse(req.body);
 const conversation=await conversationScope(db,c,actor);const safe=Math.min(sequence,conversation.nextSequence-1);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${conversation.workspaceId} FOR UPDATE`;await conversationScope(tx,c,actor);
  await tx.readCursor.upsert({where:{conversationId_userId:{conversationId:c,userId:actor.id}},create:{conversationId:c,userId:actor.id,sequence:safe},update:{}});
  await tx.readCursor.updateMany({where:{conversationId:c,userId:actor.id,sequence:{lt:safe}},data:{sequence:safe}});
 });res.json({data:{read:true}});
});
