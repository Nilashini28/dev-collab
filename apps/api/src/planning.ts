import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../../packages/db';
import type { Prisma } from '../../../packages/db/generated/client';
import * as schema from '../../../packages/contracts';
import { membership, type Actor } from './workspaces';
import { requireThat } from './errors';
type Tx=Prisma.TransactionClient;
export const planning=Router();
const key=(req:any,name:string)=>z.string().min(1).max(128).parse(req.params[name]);
export async function projectScope(tx:Tx,p:string,actor:Actor,write=false,manage=false){
 const project=await tx.project.findUnique({where:{id:p},include:{hackathon:true}});
 requireThat(project&&!project.hackathon.archivedAt,404,'NOT_FOUND','Project not found.');
 const member=await membership(tx,project.hackathon.workspaceId,actor.id,manage);
 requireThat(!write||member.role!=='VIEWER',403,'READ_ONLY','Viewers cannot make changes.');
 return project;
}
async function locked(tx:Tx,p:string,actor:Actor,manage=false){
 const project=await projectScope(tx,p,actor,true,manage);
 await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${p} FOR UPDATE`;
  return await projectScope(tx,p,actor,true,manage);
}
async function event(tx:Tx,project:{id:string;hackathon:{workspaceId:string}},actor:Actor,type:string,target:string){
 await tx.auditEvent.create({data:{workspaceId:project.hackathon.workspaceId,actorId:actor.id,action:type,targetId:target}});
 await tx.outboxEvent.create({data:{type,entityId:target}});
}
const taskInclude={assignee:{select:{id:true,name:true}},checklist:true} as const;
planning.get('/workspaces/:w/hackathons',async(req,res)=>{
 const w=key(req,'w');await membership(db,w,res.locals.actor.id);
 const input=z.object({cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(50).default(25)}).parse(req.query);
 const records=await db.hackathon.findMany({where:{workspaceId:w,archivedAt:null},include:{project:{include:{deadline:true,_count:{select:{tasks:true}},sprints:{where:{status:'ACTIVE'},take:1}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:input.limit+1,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 const more=records.length>input.limit;const items=records.slice(0,input.limit);
 res.json({items,nextCursor:more?items.at(-1)!.id:null});
});
planning.post('/workspaces/:w/hackathons',async(req,res)=>{
 const w=key(req,'w'),body=schema.eventInput.parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w} FOR UPDATE`;
  await membership(tx,w,actor.id,true);
  const hackathon=await tx.hackathon.create({data:{workspaceId:w,...body,startAt:body.startAt?new Date(body.startAt):null,endAt:body.endAt?new Date(body.endAt):null,officialUrl:body.officialUrl||null,project:{create:{name:body.name,key:body.name.replace(/[^a-z]/gi,'').slice(0,5).toUpperCase()||'TEAM'}}},include:{project:true}});
  await tx.conversation.create({data:{workspaceId:w,projectId:hackathon.project!.id,kind:'PROJECT',name:body.name,scopeKey:'project:'+hackathon.project!.id}});
  await tx.auditEvent.create({data:{workspaceId:w,actorId:actor.id,action:'hackathon.created',targetId:hackathon.id}});
  await tx.outboxEvent.create({data:{type:'hackathon.created',entityId:hackathon.id}});return hackathon;
 });res.status(201).json({data:result});
});
planning.patch('/workspaces/:w/hackathons/:h',async(req,res)=>{
 const w=key(req,'w'),h=key(req,'h'),{expectedVersion,...input}=schema.eventInput.safeExtend({expectedVersion:z.number().int().positive()}).parse(req.body);
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w} FOR UPDATE`;await membership(tx,w,res.locals.actor.id,true);
  const before=await tx.hackathon.findFirst({where:{id:h,workspaceId:w,archivedAt:null}});requireThat(before,404,'NOT_FOUND','Hackathon not found.');requireThat(before.version===expectedVersion,409,'CONFLICT','Event changed. Refresh before saving.');
  const updated=await tx.hackathon.update({where:{id:h},data:{...input,startAt:input.startAt?new Date(input.startAt):null,endAt:input.endAt?new Date(input.endAt):null,officialUrl:input.officialUrl||null,version:{increment:1}}});
  await tx.auditEvent.create({data:{workspaceId:w,actorId:res.locals.actor.id,action:'hackathon.updated',targetId:h}});return updated;
 });res.json({data:result});
});
planning.delete('/workspaces/:w/hackathons/:h',async(req,res)=>{
 const w=key(req,'w'),h=key(req,'h'),body=schema.versionInput.parse(req.body);
 await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w} FOR UPDATE`;await membership(tx,w,res.locals.actor.id,true);
 const change=await tx.hackathon.updateMany({where:{id:h,workspaceId:w,archivedAt:null,version:body.expectedVersion},data:{archivedAt:new Date(),version:{increment:1}}});requireThat(change.count,409,'CONFLICT','Event changed or is unavailable. Refresh first.');
 await tx.reminder.updateMany({where:{deadline:{project:{hackathonId:h}},state:'SCHEDULED'},data:{state:'CANCELLED'}});
 await tx.auditEvent.create({data:{workspaceId:w,actorId:res.locals.actor.id,action:'hackathon.archived',targetId:h}});
 });res.json({data:{archived:true}});
});
planning.patch('/projects/:p/details',async(req,res)=>{
 const p=key(req,'p'),{expectedVersion,...body}=schema.projectDetailsInput.parse(req.body);
 const result=await db.$transaction(async tx=>{const project=await locked(tx,p,res.locals.actor,true);
 const change=await tx.project.updateMany({where:{id:p,version:expectedVersion},data:{...body,repositoryUrl:body.repositoryUrl||null,demoUrl:body.demoUrl||null,version:{increment:1}}});requireThat(change.count,409,'CONFLICT','Project changed. Refresh before saving.');await event(tx,project,res.locals.actor,'project.updated',p);return tx.project.findUniqueOrThrow({where:{id:p}});
 });res.json({data:result});
});
planning.get('/projects/:p',async(req,res)=>{
 const p=key(req,'p'),project=await projectScope(db,p,res.locals.actor);
 const [counts,sprints,deadline,member]=await Promise.all([db.task.groupBy({by:['status'],where:{projectId:p},_count:true}),db.sprint.findMany({where:{projectId:p},orderBy:{createdAt:'desc'},take:50}),db.deadline.findUnique({where:{projectId:p}}),membership(db,project.hackathon.workspaceId,res.locals.actor.id)]);
 res.json({data:{...project,role:member.role,counts,sprints,deadline}});
});
planning.get('/projects/:p/tasks',async(req,res)=>{
 const p=key(req,'p');await projectScope(db,p,res.locals.actor);
 const input=z.object({cursor:z.string().optional(),status:schema.taskStatus.optional(),assignee:z.string().optional(),sprint:z.string().optional(),search:z.string().max(100).optional(),limit:z.coerce.number().min(1).max(100).default(100)}).parse(req.query);
 const items=await db.task.findMany({where:{projectId:p,...(input.status?{status:input.status}:{}),...(input.assignee?{assigneeId:input.assignee}:{}),...(input.sprint?{sprintId:input.sprint==='backlog'?null:input.sprint}:{}),...(input.search?{title:{contains:input.search,mode:'insensitive'}}:{})},include:taskInclude,orderBy:[{createdAt:'desc'},{id:'desc'}],take:input.limit+1,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 const more=items.length>input.limit;res.json({items:items.slice(0,input.limit),nextCursor:more?items[input.limit-1].id:null});
});
async function validAssignment(tx:Tx,project:any,body:{assigneeId?:string|null;sprintId?:string|null}){
 if(body.assigneeId)await membership(tx,project.hackathon.workspaceId,body.assigneeId);
 if(body.sprintId){const sprint=await tx.sprint.findFirst({where:{id:body.sprintId,projectId:project.id,status:{not:'COMPLETED'}}});requireThat(sprint,422,'INVALID_SPRINT','Choose a planned or active sprint in this project.');}
}
planning.post('/projects/:p/tasks',async(req,res)=>{
 const p=key(req,'p'),body=schema.taskInput.parse(req.body),actor=res.locals.actor as Actor;
 const task=await db.$transaction(async tx=>{
  const project=await locked(tx,p,actor);await validAssignment(tx,project,body);
  const counter=await tx.project.update({where:{id:p},data:{nextTaskNumber:{increment:1}}});
  const task=await tx.task.create({data:{...body,projectId:p,number:counter.nextTaskNumber-1,creatorId:actor.id,dueAt:body.dueAt?new Date(body.dueAt):null}});
  await tx.taskHistory.create({data:{taskId:task.id,actorId:actor.id,changes:{created:body}}});await event(tx,project,actor,'task.created',task.id);return task;
 });res.status(201).json({data:task});
});
planning.get('/tasks/:t',async(req,res)=>{
 const task=await db.task.findUnique({where:{id:key(req,'t')},include:{...taskInclude,history:{orderBy:{createdAt:'desc'},take:50},comments:{orderBy:{createdAt:'desc'},take:50}}});
 requireThat(task,404,'NOT_FOUND','Task not found.');await projectScope(db,task.projectId,res.locals.actor);res.json({data:task});
});
planning.patch('/tasks/:t',async(req,res)=>{
 const t=key(req,'t'),{expectedVersion,...body}=schema.taskPatch.parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const before=await tx.task.findUnique({where:{id:t}});requireThat(before,404,'NOT_FOUND','Task not found.');
  const project=await locked(tx,before.projectId,actor);await validAssignment(tx,project,body);
  const task=await tx.task.findUniqueOrThrow({where:{id:t}});
  requireThat(task.version===expectedVersion,409,'CONFLICT','This task changed. Your draft is preserved; reload the latest version before saving.');
  const updated=await tx.task.update({where:{id:t},data:{...body,...(body.dueAt!==undefined?{dueAt:body.dueAt?new Date(body.dueAt):null}:{}),version:{increment:1}}});
  await tx.taskHistory.create({data:{taskId:t,actorId:actor.id,changes:{before:{status:task.status,sprintId:task.sprintId},after:body}}});
  await event(tx,project,actor,'task.updated',t);return updated;
 });res.json({data:result});
});
planning.post('/tasks/:t/comments',async(req,res)=>{
 const t=key(req,'t'),body=z.object({body:z.string().trim().min(1).max(5000)}).parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const task=await tx.task.findUnique({where:{id:t}});requireThat(task,404,'NOT_FOUND','Task not found.');const project=await locked(tx,task.projectId,actor);
  const comment=await tx.taskComment.create({data:{taskId:t,actorId:actor.id,authorName:actor.name,body:body.body}});await event(tx,project,actor,'task.commented',t);return comment;
 });res.status(201).json({data:result});
});
planning.post('/tasks/:t/checklist',async(req,res)=>{
 const t=key(req,'t'),body=z.object({title:z.string().trim().min(1).max(200)}).parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const task=await tx.task.findUnique({where:{id:t}});requireThat(task,404,'NOT_FOUND','Task not found.');const project=await locked(tx,task.projectId,actor);
  const item=await tx.checklistItem.create({data:{taskId:t,title:body.title}});await event(tx,project,actor,'task.checklist.created',t);return item;
 });res.status(201).json({data:result});
});
planning.patch('/checklist/:i',async(req,res)=>{
 const i=key(req,'i'),body=schema.versionInput.extend({done:z.boolean()}).parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const item=await tx.checklistItem.findUnique({where:{id:i},include:{task:true}});requireThat(item,404,'NOT_FOUND','Checklist item not found.');const project=await locked(tx,item.task.projectId,actor);
  const change=await tx.checklistItem.updateMany({where:{id:i,version:body.expectedVersion},data:{done:body.done,version:{increment:1}}});requireThat(change.count,409,'CONFLICT','Checklist changed. Refresh first.');await event(tx,project,actor,'task.checklist.updated',item.taskId);return {updated:true};
 });res.json({data:result});
});
planning.get('/projects/:p/sprints',async(req,res)=>{
 const p=key(req,'p');await projectScope(db,p,res.locals.actor);const {cursor,selected}=z.object({cursor:z.string().optional(),selected:z.string().max(128).optional()}).parse(req.query);
 const items=await db.sprint.findMany({where:{projectId:p},include:{_count:{select:{tasks:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(cursor?{cursor:{id:cursor},skip:1}:{})});const featured=selected?await db.sprint.findFirst({where:{id:selected,projectId:p},include:{_count:{select:{tasks:true}}}}):null;requireThat(!selected||featured,404,'NOT_FOUND','Sprint not found in this project.');const active=await db.sprint.findFirst({where:{projectId:p,status:'ACTIVE'},include:{_count:{select:{tasks:true}}}});res.json({active,selected:featured,items:items.slice(0,50),nextCursor:items.length>50?items[49].id:null});
});
planning.post('/projects/:p/sprints',async(req,res)=>{
 const p=key(req,'p'),body=schema.sprintInput.parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{const project=await locked(tx,p,actor,true);const sprint=await tx.sprint.create({data:{...body,projectId:p,startAt:new Date(body.startAt),endAt:new Date(body.endAt)}});await event(tx,project,actor,'sprint.created',sprint.id);return sprint;});
 res.status(201).json({data:result});
});
planning.get('/workspaces/:w/sprint-dashboard',async(req,res)=>{
 const w=key(req,'w');await membership(db,w,res.locals.actor.id);
 const {cursor}=z.object({cursor:z.string().optional()}).parse(req.query);
 const items=await db.sprint.findMany({where:{project:{hackathon:{workspaceId:w,archivedAt:null}}},include:{project:{select:{id:true,name:true,hackathon:{select:{name:true}}}},_count:{select:{tasks:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(cursor?{cursor:{id:cursor},skip:1}:{})});
 res.json({items:items.slice(0,50),nextCursor:items.length>50?items[49].id:null});
});
planning.patch('/sprints/:s',async(req,res)=>{
 const id=key(req,'s'),{expectedVersion,...input}=schema.sprintInput.safeExtend({expectedVersion:z.number().int().positive()}).parse(req.body);
 const result=await db.$transaction(async tx=>{const initial=await tx.sprint.findUnique({where:{id}});requireThat(initial,404,'NOT_FOUND','Sprint not found.');const project=await locked(tx,initial.projectId,res.locals.actor,true);
 const sprint=await tx.sprint.findUniqueOrThrow({where:{id}});requireThat(sprint.status!=='COMPLETED',409,'CLOSED','Completed sprint records cannot be edited.');requireThat(sprint.version===expectedVersion,409,'CONFLICT','Sprint changed. Refresh before saving.');
 const updated=await tx.sprint.update({where:{id},data:{...input,startAt:new Date(input.startAt),endAt:new Date(input.endAt),version:{increment:1}}});await event(tx,project,res.locals.actor,'sprint.updated',id);return updated;});res.json({data:result});
});
planning.post('/sprints/:s/scope',async(req,res)=>{
 const id=key(req,'s'),body=z.object({expectedVersion:z.number().int().positive(),action:z.enum(['ADD','REMOVE']),tasks:z.array(z.object({id:z.string(),expectedVersion:z.number().int().positive()})).min(1).max(100)}).parse(req.body);
 const result=await db.$transaction(async tx=>{const initial=await tx.sprint.findUnique({where:{id}});requireThat(initial,404,'NOT_FOUND','Sprint not found.');const project=await locked(tx,initial.projectId,res.locals.actor,true);
 const sprint=await tx.sprint.findUniqueOrThrow({where:{id}});requireThat(sprint.status!=='COMPLETED',409,'CLOSED','Completed sprint scope is frozen.');requireThat(sprint.version===body.expectedVersion,409,'CONFLICT','Sprint changed. Refresh first.');
 for(const input of body.tasks){const task=await tx.task.findFirst({where:{id:input.id,projectId:project.id}});requireThat(task,404,'NOT_FOUND','Task not found in this project.');requireThat(task.version===input.expectedVersion,409,'CONFLICT','A selected task changed. Refresh before updating scope.');requireThat(body.action==='ADD'?!task.sprintId:task.sprintId===id,409,'SCOPE_CHANGED','A selected task is no longer in the expected scope.');
 const sprintId=body.action==='ADD'?id:null;await tx.task.update({where:{id:task.id},data:{sprintId,version:{increment:1}}});await tx.taskHistory.create({data:{taskId:task.id,actorId:res.locals.actor.id,changes:{before:{sprintId:task.sprintId},after:{sprintId},reason:'sprint.scope'}}});}
 await tx.sprint.update({where:{id},data:{version:{increment:1}}});await event(tx,project,res.locals.actor,'sprint.scope.updated',id);return {updated:body.tasks.length};
 });res.json({data:result});
});
planning.get('/sprints/:s/dashboard',async(req,res)=>{
 const sprint=await db.sprint.findUnique({where:{id:key(req,'s')}});requireThat(sprint,404,'NOT_FOUND','Sprint not found.');await projectScope(db,sprint.projectId,res.locals.actor);
 const [counts,start]=await Promise.all([db.task.groupBy({by:['status'],where:{sprintId:sprint.id},_count:true}),db.auditEvent.findFirst({where:{targetId:sprint.id,action:'sprint.started'},orderBy:{createdAt:'asc'}})]);
 const snapshot=Array.isArray(sprint.scopeSnapshot)?sprint.scopeSnapshot as Array<{id:string;status:string}>:[];
 const until=sprint.status==='COMPLETED'&&(sprint.summary as any)?.completedAt?new Date((sprint.summary as any).completedAt):new Date();
 const since=start?.createdAt??sprint.startAt;
 const history=snapshot.length?await db.taskHistory.findMany({where:{taskId:{in:snapshot.map(t=>t.id)},createdAt:{gte:since,lte:until}},orderBy:[{createdAt:'asc'},{id:'asc'}]}):[];
 const statuses=new Map(snapshot.map(t=>[t.id,t.status]));const points:Array<{at:string;remaining:number}>=[];let index=0;
 if(start){const duration=Math.max(0,until.getTime()-since.getTime()),steps=Math.max(1,Math.min(60,Math.ceil(duration/86400000)));
 for(let step=0;step<=steps;step++){const at=new Date(since.getTime()+duration*step/steps);while(index<history.length&&history[index].createdAt<=at){const row=history[index++];const after=(row.changes as any)?.after;if(after?.status)statuses.set(row.taskId,after.status);}points.push({at:at.toISOString(),remaining:[...statuses.values()].filter(status=>status!=='DONE').length});}}
 res.json({data:{sprint,counts,committed:snapshot.length,burndown:points,chartScope:'Tasks committed when the sprint started; later scope additions are excluded.'}});
});
planning.post('/sprints/:s/start',async(req,res)=>{
 const s=key(req,'s'),{expectedVersion}=schema.versionInput.parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const sprint=await tx.sprint.findUnique({where:{id:s}});requireThat(sprint,404,'NOT_FOUND','Sprint not found.');
  const project=await locked(tx,sprint.projectId,actor,true);
  const latest=await tx.sprint.findUniqueOrThrow({where:{id:s}});
  requireThat(latest.version===expectedVersion&&latest.status==='PLANNED',409,'CONFLICT','Sprint changed or is no longer planned.');
  requireThat(!await tx.sprint.findFirst({where:{projectId:project.id,status:'ACTIVE'}}),409,'ACTIVE_SPRINT','Complete the active sprint first.');
  const tasks=await tx.task.findMany({where:{sprintId:s},select:{id:true,status:true}});
  requireThat(tasks.length>0,422,'EMPTY_SPRINT','Add tasks before starting the sprint.');
  const updated=await tx.sprint.update({where:{id:s},data:{status:'ACTIVE',scopeSnapshot:tasks,version:{increment:1}}});await event(tx,project,actor,'sprint.started',s);return updated;
 });res.json({data:result});
});
planning.post('/sprints/:s/complete',async(req,res)=>{
 const s=key(req,'s'),body=schema.versionInput.extend({unfinishedDestination:z.enum(['BACKLOG','KEEP'])}).parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const initial=await tx.sprint.findUnique({where:{id:s}});requireThat(initial,404,'NOT_FOUND','Sprint not found.');const project=await locked(tx,initial.projectId,actor,true);
  const sprint=await tx.sprint.findUniqueOrThrow({where:{id:s}});
  requireThat(sprint.version===body.expectedVersion&&sprint.status==='ACTIVE',409,'CONFLICT','Sprint changed or is not active.');
  const tasks=await tx.task.findMany({where:{sprintId:s}});const unfinished=tasks.filter(t=>t.status!=='DONE');
  if(body.unfinishedDestination==='BACKLOG'){
   for(const task of unfinished){await tx.task.update({where:{id:task.id},data:{sprintId:null,version:{increment:1}}});await tx.taskHistory.create({data:{taskId:task.id,actorId:actor.id,changes:{before:{sprintId:s},after:{sprintId:null},reason:'sprint.completed'}}});}
  }
  const updated=await tx.sprint.update({where:{id:s},data:{status:'COMPLETED',version:{increment:1},summary:{total:tasks.length,done:tasks.length-unfinished.length,unfinished:unfinished.length,decision:body.unfinishedDestination,completedAt:new Date().toISOString()}}});await event(tx,project,actor,'sprint.completed',s);return updated;
 });res.json({data:result});
});
planning.put('/projects/:p/deadline',async(req,res)=>{
 const p=key(req,'p'),body=schema.deadlineInput.parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const project=await locked(tx,p,actor,true);const existing=await tx.deadline.findUnique({where:{projectId:p}});
  requireThat((existing?.version??0)===body.expectedVersion,409,'CONFLICT','Deadline changed. Review the latest date first.');
  const values={instant:new Date(body.instant),timezone:body.timezone,sourceUrl:body.sourceUrl,sourceExcerpt:body.sourceExcerpt,confirmedBy:actor.id};
  const deadline=await tx.deadline.upsert({where:{projectId:p},create:{projectId:p,...values},update:{...values,version:{increment:1}}});
  await tx.reminder.updateMany({where:{deadlineId:deadline.id,state:'SCHEDULED'},data:{state:'CANCELLED'}});
  if(project.hackathon.status==='ACTIVE')for(const offsetHours of [24,6,1]){
   const scheduledAt=new Date(deadline.instant.getTime()-offsetHours*3600000);
   if(scheduledAt>new Date())await tx.reminder.create({data:{deadlineId:deadline.id,deadlineVersion:deadline.version,offsetHours,scheduledAt}});
  }
  await event(tx,project,actor,'deadline.confirmed',deadline.id);return deadline;
 });res.json({data:result});
});
planning.post('/projects/:p/submission',async(req,res)=>{
 const p=key(req,'p'),body=schema.versionInput.extend({status:z.enum(['ACTIVE','SUBMITTED','CANCELLED'])}).parse(req.body),actor=res.locals.actor as Actor;
 const result=await db.$transaction(async tx=>{
  const project=await locked(tx,p,actor,true);
  requireThat(project.hackathon.version===body.expectedVersion,409,'CONFLICT','Hackathon changed. Refresh before saving.');
  await tx.hackathon.update({where:{id:project.hackathonId},data:{status:body.status,version:{increment:1}}});
  if(body.status!=='ACTIVE')await tx.reminder.updateMany({where:{deadline:{projectId:p},state:'SCHEDULED'},data:{state:'CANCELLED'}});
  await event(tx,project,actor,'submission.changed',project.hackathonId);return {status:body.status};
 });res.json({data:result});
});
planning.get('/notifications',async(req,res)=>{
 const input=z.object({cursor:z.string().optional()}).parse(req.query);
 const memberships=await db.membership.findMany({where:{userId:res.locals.actor.id,active:true},select:{workspaceId:true}});
 const items=await db.notification.findMany({where:{userId:res.locals.actor.id,workspaceId:{in:memberships.map(m=>m.workspaceId)}},take:51,orderBy:[{createdAt:'desc'},{id:'desc'}],...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 res.json({items:items.slice(0,50),nextCursor:items.length>50?items[49].id:null});
});
planning.post('/projects/:p/deadline-proposals',async(req,res)=>{
 const p=key(req,'p'),actor=res.locals.actor as Actor;
 const body=z.object({url:z.url().refine(value=>value.startsWith('https://'),'Use an HTTPS URL.')}).parse(req.body);
 const proposal=await db.$transaction(async tx=>{
  const project=await locked(tx,p,actor,true);
  const pending=await tx.deadlineProposal.count({where:{projectId:p,createdAt:{gt:new Date(Date.now()-60000)}}});
  requireThat(pending<3,429,'RATE_LIMIT','Wait before requesting another extraction.');
  const proposal=await tx.deadlineProposal.create({data:{projectId:p,sourceUrl:body.url}});
  await event(tx,project,actor,'deadline.extraction.queued',proposal.id);return proposal;
 });res.status(202).json({data:proposal});
});
planning.get('/projects/:p/deadline-proposals',async(req,res)=>{
 const p=key(req,'p');await projectScope(db,p,res.locals.actor);
 res.json({items:await db.deadlineProposal.findMany({where:{projectId:p},orderBy:{createdAt:'desc'},take:10}),nextCursor:null});
});
planning.post('/notifications/:n/read',async(req,res)=>{await db.notification.updateMany({where:{id:key(req,'n'),userId:res.locals.actor.id},data:{readAt:new Date()}});res.json({data:{read:true}});});
planning.post('/projects/:p/test-reminder',async(req,res)=>{
 const project=await projectScope(db,key(req,'p'),res.locals.actor,false,true);
 const notification=await db.notification.create({data:{userId:res.locals.actor.id,workspaceId:project.hackathon.workspaceId,title:'Test reminder',body:'Your in-app reminders are working for '+project.name+'.',sourceKey:'test-'+crypto.randomUUID()}});
 res.status(201).json({data:notification});
});
export async function dispatchReminders(){
 await dispatchEventReminders();
 const due=await db.reminder.findMany({where:{state:'SCHEDULED',scheduledAt:{lte:new Date()}},take:100});
 for(const reminder of due)await db.$transaction(async tx=>{
  const deadline=await tx.deadline.findUniqueOrThrow({where:{id:reminder.deadlineId},include:{project:{include:{hackathon:true}}}});
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${deadline.project.hackathon.workspaceId} FOR UPDATE`;
  const latest=await tx.deadline.findUniqueOrThrow({where:{id:deadline.id},include:{project:{include:{hackathon:true}}}});
  const claimed=await tx.reminder.updateMany({where:{id:reminder.id,state:'SCHEDULED'},data:{state:'PROCESSED'}});if(!claimed.count)return;
  if(latest.version!==reminder.deadlineVersion||latest.project.hackathon.status!=='ACTIVE'||!!latest.project.hackathon.archivedAt)return;
  const members=await tx.membership.findMany({where:{workspaceId:latest.project.hackathon.workspaceId,active:true}});
  for(const member of members)await tx.notification.upsert({where:{userId_sourceKey:{userId:member.userId,sourceKey:reminder.id}},create:{userId:member.userId,workspaceId:member.workspaceId,title:'Submission deadline approaching',body:latest.project.name+' is due '+latest.instant.toISOString()+' ('+latest.timezone+').',sourceKey:reminder.id},update:{}});
  await tx.outboxEvent.create({data:{type:'reminder.sent',entityId:reminder.id}});
 });
}

export async function dispatchEventReminders(now=new Date()){
 const events=await db.hackathon.findMany({where:{archivedAt:null,status:'ACTIVE',startAt:{gt:now,lte:new Date(now.getTime()+86400000)}}});
 for(const event of events)await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${event.workspaceId} FOR UPDATE`;
  const current=await tx.hackathon.findUniqueOrThrow({where:{id:event.id}});
  if(current.archivedAt||current.status!=='ACTIVE'||!current.startAt||current.startAt<=now)return;
  const remaining=current.startAt.getTime()-now.getTime();
  // One catch-up notification per event version rather than a burst after downtime.
  const offset=[1,6,24].find(hours=>remaining<=hours*3600000);if(!offset)return;
  const sourceKey='event:'+current.id+':'+current.version+':'+offset;
  const members=await tx.membership.findMany({where:{workspaceId:current.workspaceId,active:true}});
  for(const member of members)await tx.notification.upsert({where:{userId_sourceKey:{userId:member.userId,sourceKey}},create:{userId:member.userId,workspaceId:member.workspaceId,title:'Hackathon starts soon',body:current.name+' starts '+new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short',timeZone:current.timezone}).format(current.startAt)+' ('+current.timezone+').',sourceKey},update:{}});
 });
}
