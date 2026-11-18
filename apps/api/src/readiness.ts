import {Router} from 'express';
import {z} from 'zod';
import {db} from '../../../packages/db';
import {projectScope} from './planning';
import {membership} from './workspaces';
import {requireThat} from './errors';
import {config} from './config';
import {mayManage} from '../../../packages/contracts';
export const readiness=Router();
const link=z.union([z.literal(''),z.url().max(2000).refine(v=>v.startsWith('https://'),'Use an HTTPS link.')]).nullable();
const itemInput=z.object({title:z.string().trim().min(2).max(160),kind:z.enum(['CUSTOM','REPOSITORY','DEMO','PITCH','ARCHITECTURE']).default('CUSTOM'),required:z.boolean().default(true),done:z.boolean().default(false),ownerId:z.string().max(128).nullable().default(null),url:link.default(null),wikiPageId:z.string().max(128).nullable().default(null),notes:z.string().trim().max(4000).default('')});
const patchInput=z.object({expectedVersion:z.number().int().positive(),title:itemInput.shape.title.optional(),required:z.boolean().optional(),done:z.boolean().optional(),ownerId:z.string().max(128).nullable().optional(),url:link.optional(),wikiPageId:z.string().max(128).nullable().optional(),notes:z.string().trim().max(4000).optional()});
const starters=[{title:'Source repository',kind:'REPOSITORY',templateKey:'repository'},{title:'Working demo',kind:'DEMO',templateKey:'demo'},{title:'Pitch deck',kind:'PITCH',templateKey:'pitch'},{title:'Architecture and workflow',kind:'ARCHITECTURE',templateKey:'architecture'},{title:'Official submission form reviewed',kind:'CUSTOM',templateKey:'form'}];
async function lock(tx:any,p:string,actor:any,manage=false){const project=await projectScope(tx,p,actor,true,manage);await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;return projectScope(tx,p,actor,true,manage);}
async function validate(tx:any,p:any,item:any){
 if(item.ownerId)requireThat(await tx.membership.findFirst({where:{workspaceId:p.hackathon.workspaceId,userId:item.ownerId,active:true,role:{not:'VIEWER'}}}),422,'INVALID_OWNER','Assign an active teammate with write access.');
 if(item.wikiPageId)requireThat(await tx.wikiPage.findFirst({where:{id:item.wikiPageId,projectId:p.id}}),422,'INVALID_WIKI','Choose a wiki page from this project.');
}
async function event(tx:any,p:any,actor:any,action:string,id:string){await tx.auditEvent.create({data:{workspaceId:p.hackathon.workspaceId,actorId:actor.id,action,targetId:id}});}
export async function readinessSnapshot(p:string,actor:any){
 return db.$transaction(async tx=>{
  const project=await projectScope(tx,p,actor);await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR SHARE`;await projectScope(tx,p,actor);
  const [items,deadline,members,pages]=await Promise.all([tx.submissionItem.findMany({where:{projectId:p},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100}),tx.deadline.findUnique({where:{projectId:p}}),tx.membership.findMany({where:{workspaceId:project.hackathon.workspaceId,active:true},include:{user:{select:{id:true,name:true}}}}),tx.wikiPage.findMany({where:{projectId:p},select:{id:true,title:true},orderBy:{updatedAt:'desc'},take:500})]);
  const rows=items.map(item=>{
   const owner=members.find(m=>m.userId===item.ownerId&&m.role!=='VIEWER')?.user??null,page=pages.find(w=>w.id===item.wikiPageId)??null;
   const evidenceUrl=item.kind==='REPOSITORY'?(item.url||project.repositoryUrl):item.kind==='DEMO'?(item.url||project.demoUrl):item.url;
   const missing=[...(!owner?['Assign an active owner']:[]),...(!item.done?['Completion confirmation needed']:[]),...(item.kind==='ARCHITECTURE'&&!page?['Select a project wiki page']:[]),...(['REPOSITORY','DEMO','PITCH'].includes(item.kind)&&!evidenceUrl?['Add an evidence link']:[])];
   return {...item,owner,page,evidenceUrl,missing,ready:missing.length===0};
  });
  const required=rows.filter(i=>i.required),blockers=[...(!deadline?['Confirm the official submission deadline']:[]),...(!required.length?['Add at least one required deliverable']:[]),...required.filter(i=>!i.ready).map(i=>i.title+': '+i.missing.join('; '))];
  const deadlinePassed=!!deadline&&deadline.instant.getTime()<=Date.now();if(deadlinePassed)blockers.unshift('The confirmed deadline has passed');
  const warnings=[...(!project.hackathon.officialUrl?['Add the official hackathon URL']:[]),...(deadline&&!deadline.sourceUrl?['The confirmed deadline has no source URL']:[])];
  return {project:{id:project.id,name:project.name,description:project.description,repositoryUrl:project.repositoryUrl,demoUrl:project.demoUrl},hackathon:project.hackathon,deadline,deadlinePassed,items:rows,owners:members.filter(m=>m.role!=='VIEWER').map(m=>m.user),pages,requiredTotal:required.length,requiredReady:required.filter(i=>i.ready).length,ready:blockers.length===0,blockers,warnings,generatedAt:new Date().toISOString()};
 });
}
readiness.get('/projects/:p/readiness',async(req,res)=>res.json({data:await readinessSnapshot(String(req.params.p),res.locals.actor)}));
readiness.post('/projects/:p/readiness/starter',async(req,res)=>{
 const p=String(req.params.p);await db.$transaction(async tx=>{const project=await lock(tx,p,res.locals.actor,true);const old=await tx.submissionItem.findMany({where:{projectId:p},select:{templateKey:true}}),missing=starters.filter(s=>!old.some(i=>i.templateKey===s.templateKey));requireThat(old.length+missing.length<=100,422,'CHECKLIST_LIMIT','Limit the checklist to 100 deliverables.');if(missing.length)await tx.submissionItem.createMany({data:missing.map(s=>({...s,projectId:p}))});await event(tx,project,res.locals.actor,'readiness.starter',p);});res.status(201).json({data:{created:true}});
});
readiness.post('/projects/:p/readiness/items',async(req,res)=>{
 const p=String(req.params.p),body=itemInput.parse(req.body);const item=await db.$transaction(async tx=>{const project=await lock(tx,p,res.locals.actor,true);requireThat(await tx.submissionItem.count({where:{projectId:p}})<100,422,'CHECKLIST_LIMIT','Limit the checklist to 100 deliverables.');await validate(tx,project,body);const item=await tx.submissionItem.create({data:{...body,url:body.url||null,projectId:p}});await event(tx,project,res.locals.actor,'readiness.created',item.id);return item;});res.status(201).json({data:item});
});
readiness.patch('/projects/:p/readiness/items/:id',async(req,res)=>{
 const p=String(req.params.p),{expectedVersion,...body}=patchInput.parse(req.body);requireThat(Object.keys(body).length,422,'EMPTY_UPDATE','Choose a change to save.');
 const result=await db.$transaction(async tx=>{const project=await lock(tx,p,res.locals.actor),member=await membership(tx,project.hackathon.workspaceId,res.locals.actor.id);const old=await tx.submissionItem.findFirst({where:{id:String(req.params.id),projectId:p}});requireThat(old,404,'NOT_FOUND','Deliverable not found.');requireThat(mayManage(member.role)||(old.ownerId===res.locals.actor.id&&Object.keys(body).every(k=>k==='done')),403,'READINESS_FORBIDDEN','Only leaders can edit deliverables; assigned owners can confirm their own items.');await validate(tx,project,{...old,...body});const result=await tx.submissionItem.updateMany({where:{id:old.id,version:expectedVersion},data:{...body,...(body.url!==undefined?{url:body.url||null}:{}),version:{increment:1}}});requireThat(result.count,409,'CONFLICT','This deliverable changed. Refresh before saving.');await event(tx,project,res.locals.actor,'readiness.updated',old.id);return {updated:true};});res.json({data:result});
});
readiness.delete('/projects/:p/readiness/items/:id',async(req,res)=>{
 const p=String(req.params.p),{expectedVersion}=z.object({expectedVersion:z.number().int().positive()}).parse(req.body);await db.$transaction(async tx=>{const project=await lock(tx,p,res.locals.actor,true);const old=await tx.submissionItem.findFirst({where:{id:String(req.params.id),projectId:p}});requireThat(old,404,'NOT_FOUND','Deliverable not found.');requireThat(old.version===expectedVersion,409,'CONFLICT','This deliverable changed. Refresh before removing.');await tx.submissionItem.delete({where:{id:old.id}});await event(tx,project,res.locals.actor,'readiness.removed',old.id);});res.json({data:{removed:true}});
});
const md=(s:string)=>s.replace(/[\\`*_[\]<>#|]/g,'\\$&').replace(/[\r\n]+/g,' ');
readiness.get('/projects/:p/readiness/export',async(req,res)=>{
 const {format}=z.object({format:z.enum(['markdown','json']).default('markdown')}).parse(req.query),data=await readinessSnapshot(String(req.params.p),res.locals.actor);
 const lines=['# '+md(data.project.name)+' — Submission readiness','', 'Generated: '+data.generatedAt,'','This is an internal team checklist, not proof of submission or official eligibility.','', 'Status: '+(data.ready?'Internally ready':'Needs attention'),'Confirmed deadline: '+(data.deadline?data.deadline.instant.toISOString()+' ('+data.deadline.timezone+')':'Not confirmed'),'Deadline source: '+(data.deadline?.sourceUrl??'Not provided'),'Repository: '+(data.project.repositoryUrl??'Not set'),'Demo: '+(data.project.demoUrl??'Not set'),'Official event: '+(data.hackathon.officialUrl??'Not set'),'Team submission status: '+data.hackathon.status,'','## Missing requirements',...data.blockers.map(b=>'- '+md(b)),'','## Deliverables',...data.items.flatMap(i=>['- ['+(i.ready?'x':' ')+'] '+md(i.title)+(i.required?' (required)':' (optional)'), '  - Owner: '+md(i.owner?.name??'Unassigned'),'  - Confirmation: '+(i.done?'Confirmed':'Pending'),'  - Evidence: '+(i.page?'['+md(i.page.title)+']('+config.APP_ORIGIN+'/w/'+data.hackathon.workspaceId+'/p/'+data.project.id+'?tab=wiki&page='+i.page.id+')':i.evidenceUrl??'Not provided'),...(i.notes?['  - Notes: '+md(i.notes)]:[])]),'','Final submission must be completed on the official hackathon website.'];
 res.json({data:{filename:'submission-readiness.'+(format==='json'?'json':'md'),content:format==='json'?JSON.stringify(data,null,2):lines.join('\n')}});
});
