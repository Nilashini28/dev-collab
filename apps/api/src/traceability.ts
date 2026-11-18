import {Router} from 'express';
import {z} from 'zod';
import {db} from '../../../packages/db';
import {projectScope} from './planning';
import {requireThat} from './errors';
export const traceability=Router();
async function scope(tx:any,id:string,actor:any,write=false,manage=false){
 const task=await tx.task.findUnique({where:{id}});requireThat(task,404,'NOT_FOUND','Task not found.');
 const project=await projectScope(tx,task.projectId,actor,write,manage);
 if(write){await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;await projectScope(tx,task.projectId,actor,write,manage);}
 return {task:await tx.task.findUniqueOrThrow({where:{id}}),project};
}
async function record(tx:any,task:any,project:any,actor:any,reason:string,details:any){
 await tx.task.update({where:{id:task.id},data:{version:{increment:1}}});
 await tx.taskHistory.create({data:{taskId:task.id,actorId:actor.id,changes:{reason,...details}}});
 await tx.auditEvent.create({data:{workspaceId:project.hackathon.workspaceId,actorId:actor.id,action:reason,targetId:task.id}});
}
traceability.get('/tasks/:t/traceability',async(req,res)=>{
 const {task}=await scope(db,String(req.params.t),res.locals.actor);
 const [links,history,connection,wiki]=await Promise.all([
 db.taskPullLink.findMany({where:{taskId:task.id},include:{pull:{include:{connection:{select:{state:true,syncedAt:true}}}}},orderBy:{createdAt:'asc'}}),
 db.taskHistory.findMany({where:{taskId:task.id},orderBy:[{createdAt:'asc'},{id:'asc'}],take:200}),
 db.repositoryConnection.findUnique({where:{projectId:task.projectId},select:{state:true,fullName:true,syncedAt:true}}),
 task.requirementWikiId?db.wikiPage.findFirst({where:{id:task.requirementWikiId,projectId:task.projectId},select:{id:true,title:true}}):null]);
 res.json({data:{task,links,history,connection,wiki}});
});
traceability.patch('/tasks/:t/traceability',async(req,res)=>{
 const body=z.object({expectedVersion:z.number().int().positive(),requirement:z.string().trim().max(4000).optional(),requirementWikiId:z.string().max(128).nullable().optional(),autoCompleteOnMerge:z.boolean().optional()}).strict().parse(req.body);
 const result=await db.$transaction(async tx=>{
 const {task,project}=await scope(tx,String(req.params.t),res.locals.actor,true,body.autoCompleteOnMerge!==undefined);
 requireThat(task.version===body.expectedVersion,409,'CONFLICT','Task changed. Reload before saving.');
 if(body.requirementWikiId)requireThat(await tx.wikiPage.findFirst({where:{id:body.requirementWikiId,projectId:task.projectId}}),422,'INVALID_SOURCE','Choose a wiki page from this project.');
 const {expectedVersion,...data}=body;await tx.task.update({where:{id:task.id},data});
 await record(tx,task,project,res.locals.actor,'traceability.settings',{after:data});return {updated:true};
 });res.json({data:result});
});
traceability.post('/tasks/:t/pulls',async(req,res)=>{
 const body=z.object({url:z.string().url().max(2000)}).strict().parse(req.body);
 const url=new URL(body.url);requireThat(url.origin==='https://github.com'&&!url.username&&!url.password&&!url.search&&!url.hash,422,'INVALID_PULL_URL','Use a GitHub pull request URL: https://github.com/owner/repository/pull/123.');
 const match=url.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/);requireThat(match,422,'INVALID_PULL_URL','Use a GitHub pull request URL.');
 const number=z.coerce.number().int().positive().max(2147483647).parse(match[2]);
 const result=await db.$transaction(async tx=>{
 const {task,project}=await scope(tx,String(req.params.t),res.locals.actor,true);
 const connection=await tx.repositoryConnection.findUnique({where:{projectId:task.projectId}});
 requireThat(connection&&connection.state==='READY',409,'SYNC_REQUIRED','Connect and successfully sync the project repository first.');
 requireThat(connection.fullName.toLowerCase()===match[1].toLowerCase(),422,'WRONG_REPOSITORY','Choose a pull request from this project’s connected repository.');
 const pull=await tx.gitPullRequest.findUnique({where:{connectionId_number:{connectionId:connection.id,number}}});requireThat(pull,422,'PULL_NOT_IMPORTED','This PR is not in the imported history. Sync the repository and retry.');
 const existing=await tx.taskPullLink.findUnique({where:{taskId_url:{taskId:task.id,url:pull.url}}});if(existing)return existing;
 requireThat(await tx.taskPullLink.count({where:{taskId:task.id}})<30,422,'LINK_LIMIT','A task can link up to 30 pull requests.');
 const link=await tx.taskPullLink.create({data:{taskId:task.id,pullId:pull.id,url:pull.url,number:pull.number,title:pull.title,state:pull.state,reviewState:pull.reviewState}});
 await record(tx,task,project,res.locals.actor,'traceability.linked',{pull:{url:pull.url,number:pull.number,title:pull.title,state:pull.state}});return link;
 });res.status(201).json({data:result});
});
traceability.delete('/tasks/:t/pulls/:l',async(req,res)=>{
 await db.$transaction(async tx=>{
 const {task,project}=await scope(tx,String(req.params.t),res.locals.actor,true);
 const link=await tx.taskPullLink.findFirst({where:{id:String(req.params.l),taskId:task.id}});requireThat(link,404,'NOT_FOUND','Task link not found.');
 await tx.taskPullLink.delete({where:{id:link.id}});await record(tx,task,project,res.locals.actor,'traceability.unlinked',{pull:{url:link.url,number:link.number}});
 });res.json({data:{removed:true}});
});
