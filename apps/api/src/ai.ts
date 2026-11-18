import {Router} from 'express';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {db} from '../../../packages/db';
import {projectScope} from './planning';
import {requireThat} from './errors';
export const ai=Router();
import {aiAvailable,suggestion,aiResult,safeDiagram} from './ai-contracts';
import {generateReview,validateContextSelection} from './ai-service';
import {contextOptions} from './ai-contracts';
export {aiAvailable,aiResult} from './ai-contracts';
ai.get('/projects/:p/ai',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 await db.aiRun.updateMany({where:{projectId:p,userId:res.locals.actor.id,state:{in:['QUEUED','RUNNING']},updatedAt:{lt:new Date(Date.now()-180000)}},data:{state:'FAILED',errorCode:'REQUEST_INTERRUPTED'}});
 res.json({available:aiAvailable(),execution:'inline',context:{tasks:30,wikiPages:10,recentAnswers:3,privateMessages:false,repositoryCode:false},items:await db.aiRun.findMany({where:{projectId:p,userId:res.locals.actor.id},orderBy:{createdAt:'desc'},take:20,include:{approval:true}})});
});
ai.get('/projects/:p/ai/context',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 const [tasks,wiki]=await Promise.all([db.task.findMany({where:{projectId:p},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:100,select:{id:true,title:true,number:true}}),db.wikiPage.findMany({where:{projectId:p},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:100,select:{id:true,title:true,version:true}})]);
 res.json({data:{tasks,wiki,limits:{tasks:30,wiki:10,documents:5,sectionsPerDocument:10,sectionCharacters:1000,listedTasks:100,listedWikiPages:100}}});
});
ai.post('/projects/:p/ai',async(req,res)=>{
 const p=String(req.params.p),actor=res.locals.actor,body=z.object({prompt:z.string().trim().min(10).max(3000),documentIds:z.array(z.string()).max(5).default([]),mode:z.enum(['ASK','ARCHITECTURE','REVIEW']).default('REVIEW'),context:contextOptions.default({project:true,schedule:true,tasks:true,wiki:true,repository:true,history:true})}).parse(req.body);
 await projectScope(db,p,actor,true);
 requireThat(aiAvailable(),503,'AI_UNAVAILABLE','AI is not configured. Your documents and wiki are still available.');
 const result=await db.$transaction(async tx=>{
  const project=await projectScope(tx,p,actor,true);await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;await projectScope(tx,p,actor,true);
  const docs=await tx.document.count({where:{id:{in:body.documentIds},projectId:p,state:'READY'}});requireThat(docs===new Set(body.documentIds).size,422,'INVALID_DOCUMENT','Select readable documents from this project.');
  await validateContextSelection(tx,p,body.documentIds,body.context);
  const count=await tx.aiRun.count({where:{project:{hackathon:{workspaceId:project.hackathon.workspaceId}},createdAt:{gt:new Date(Date.now()-86400000)}}});requireThat(count<20,429,'AI_LIMIT','This workspace has reached its daily limit of 20 requests.');
  requireThat(!await tx.aiRun.count({where:{projectId:p,userId:actor.id,state:{in:['QUEUED','RUNNING']},updatedAt:{gt:new Date(Date.now()-180000)}}}),409,'AI_BUSY','A request is already in progress. Wait for it to finish.');
  return tx.aiRun.create({data:{prompt:'['+body.mode+'] '+body.prompt,documentIds:[...new Set(body.documentIds)],projectId:p,userId:actor.id,model:process.env.LLM_MODEL!,contextOptions:body.context}});
 });
 await generateReview(result.id);
 await projectScope(db,p,actor,true);
 res.status(201).json({data:await db.aiRun.findUniqueOrThrow({where:{id:result.id}})});
});
ai.post('/ai/:id/approve',async(req,res)=>{
 const actor=res.locals.actor,id=String(req.params.id),body=z.object({tasks:z.array(suggestion).max(20),wiki:z.object({title:z.string().min(2).max(160),content:z.string().max(20000),mermaid:z.string().max(5000)}).nullable()}).parse(req.body);
 requireThat(body.tasks.length||body.wiki,422,'EMPTY_APPROVAL','Select tasks or a wiki draft to save.');
 requireThat(!body.wiki||safeDiagram(body.wiki.mermaid),422,'UNSAFE_DIAGRAM','Use a plain Mermaid flowchart without HTML, links or directives.');
 const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 const result=await db.$transaction(async tx=>{
  const run=await tx.aiRun.findFirst({where:{id,userId:actor.id,state:'READY'}});requireThat(run,404,'NOT_FOUND','Review not found.');
  const project=await projectScope(tx,run.projectId,actor,true);await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;await projectScope(tx,run.projectId,actor,true);
  const prior=await tx.aiApproval.findUnique({where:{runId:id}});if(prior){requireThat(prior.requestHash===hash,409,'ALREADY_APPROVED','This review was already saved with different edits.');return prior;}
  const taskIds:string[]=[];
  for(const draft of body.tasks){const counter=await tx.project.update({where:{id:project.id},data:{nextTaskNumber:{increment:1}}});const task=await tx.task.create({data:{...draft,projectId:project.id,number:counter.nextTaskNumber-1,creatorId:actor.id}});taskIds.push(task.id);await tx.taskHistory.create({data:{taskId:task.id,actorId:actor.id,changes:{created:draft,aiRunId:id}}});}
  let wikiId:string|null=null;if(body.wiki){const page=await tx.wikiPage.create({data:{...body.wiki,projectId:project.id,authorId:actor.id,authorName:actor.name}});wikiId=page.id;
   const members=await tx.membership.findMany({where:{workspaceId:project.hackathon.workspaceId,active:true,userId:{not:actor.id}},select:{userId:true}});
   await tx.notification.createMany({data:members.map(m=>({userId:m.userId,workspaceId:project.hackathon.workspaceId,title:'New project architecture in the wiki',body:actor.name+' published '+body.wiki!.title+' in '+project.name+'.',sourceKey:'ai-wiki:'+id}))});
   await tx.wikiRevision.create({data:{...body.wiki,pageId:page.id,version:1,authorId:actor.id,authorName:actor.name}});}
  const approval=await tx.aiApproval.create({data:{runId:id,actorId:actor.id,requestHash:hash,taskIds,wikiId}});
  await tx.auditEvent.create({data:{workspaceId:project.hackathon.workspaceId,actorId:actor.id,action:'ai.approved',targetId:id}});await tx.outboxEvent.create({data:{type:'ai.approved',entityId:id}});return approval;
 });res.json({data:result});
});
