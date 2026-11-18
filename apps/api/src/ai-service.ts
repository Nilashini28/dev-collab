import {z} from 'zod';
import {requestAssistant} from './ai-provider';
import {db} from '../../../packages/db';
import {aiResult,aiAvailable,safeDiagram} from './ai-contracts';
import {projectScope} from './planning';
import {contextOptions} from './ai-contracts';
import {requireThat,AppError} from './errors';
import {checkEvidence,providerTokenCount,type ContextSource} from './ai-evidence';

export async function validateContextSelection(tx:any,projectId:string,documentIds:string[],options:z.infer<typeof contextOptions>){
 const docs=await tx.document.count({where:{id:{in:documentIds},projectId,state:'READY'}});requireThat(docs===new Set(documentIds).size,422,'DOCUMENT_UNAVAILABLE','Select readable documents from this project.');
 for(const [ids,model] of [[options.taskIds,'task'],[options.wikiIds,'wikiPage']] as const){if(ids)requireThat(await tx[model].count({where:{projectId,id:{in:ids}}})===new Set(ids).size,422,'INVALID_CONTEXT','Choose sources from this project.');}
 if(options.sectionIds){
 const selected=await tx.documentChunk.findMany({where:{id:{in:options.sectionIds},document:{projectId,state:'READY',id:{in:documentIds}}},select:{documentId:true}});
 requireThat(selected.length===new Set(options.sectionIds).size,422,'INVALID_CONTEXT','Choose sections from your selected project documents.');
 const counts=new Map<string,number>();for(const section of selected)counts.set(section.documentId,(counts.get(section.documentId)??0)+1);
 requireThat([...counts.values()].every(count=>count<=10),422,'INVALID_CONTEXT','Select at most 10 sections per document.');
 }
}
export async function projectContext(projectId:string,userId:string,documentIds:string[],runId:string,selection:unknown={}){
 const options=contextOptions.parse(selection??{});await validateContextSelection(db,projectId,documentIds,options);
 const project=await db.project.findUniqueOrThrow({where:{id:projectId},include:{hackathon:true,deadline:true,repository:true}});
 const [tasks,pages,docs,history,taskCount,wikiCount]=await Promise.all([
  options.tasks?db.task.findMany({where:{projectId,...(options.taskIds?{id:{in:options.taskIds}}:{})},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:30,select:{id:true,number:true,title:true,description:true,status:true,priority:true}}):[],
  options.wiki?db.wikiPage.findMany({where:{projectId,...(options.wikiIds?{id:{in:options.wikiIds}}:{})},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:10,select:{id:true,title:true,content:true,mermaid:true,version:true}}):[],
  db.document.findMany({where:{id:{in:documentIds},projectId,state:'READY'},include:{chunks:{where:options.sectionIds?{id:{in:options.sectionIds}}:{},orderBy:[{section:'asc'},{id:'asc'}],take:10}}}),
  options.history?db.aiRun.findMany({where:{projectId,userId,id:{not:runId},state:'READY'},orderBy:{createdAt:'desc'},take:3}):[],
  db.task.count({where:{projectId}}),db.wikiPage.count({where:{projectId}})
 ]);
 const rows:Array<Omit<ContextSource,'sourceId'>>=[];
 if(options.project)rows.push({documentId:'project:'+project.id,title:project.name,section:'Project details',text:JSON.stringify({name:project.name,description:project.description,status:project.status,repositoryUrl:project.repositoryUrl,demoUrl:project.demoUrl})});
 if(options.schedule)rows.push({documentId:'hackathon:'+project.hackathon.id,title:project.hackathon.name,section:'Hackathon schedule',text:JSON.stringify({name:project.hackathon.name,officialUrl:project.hackathon.officialUrl,startAt:project.hackathon.startAt,endAt:project.hackathon.endAt,timezone:project.hackathon.timezone,format:project.hackathon.format,venue:project.hackathon.venue,participationDetails:project.hackathon.participationDetails,deadline:project.deadline?.instant})});
 rows.push(...tasks.map(t=>({documentId:'task:'+t.id,title:t.title,section:'Task '+t.number,text:JSON.stringify({...t,description:t.description.slice(0,800)})})),
 ...pages.map(p=>({documentId:'wiki:'+p.id,title:p.title,section:'Wiki v'+p.version,version:p.version,text:p.content.slice(0,1500)+'\n'+p.mermaid.slice(0,500)})),
 ...docs.flatMap(d=>d.chunks.map(c=>({documentId:d.id,title:d.title,section:c.section,chunkId:c.id,text:c.text.slice(0,1000)}))));
 if(options.repository&&project.repository)rows.push({documentId:'repository:'+project.repository.id,title:'Connected repository',section:'Repository metadata',text:JSON.stringify({fullName:project.repository.fullName,branch:project.repository.branch,state:project.repository.state,syncedAt:project.repository.syncedAt})});
 const sources:ContextSource[]=rows.map((row,i)=>({...row,sourceId:'S'+(i+1)}));
 const coverage={tasksIncluded:tasks.length,totalTasks:taskCount,wikiIncluded:pages.length,totalWikiPages:wikiCount,documentsIncluded:docs.length,sectionsIncluded:docs.reduce((n,d)=>n+d.chunks.length,0),documentChunkLimit:10,documentChunkCharacters:1000,privateMessagesIncluded:false,repositoryCodeIncluded:false,selection:options,historyIncluded:history.length};
 const previous=history.reverse().map(r=>({question:r.prompt,answer:String((r.result as any)?.answer??'').slice(0,2000)}));
 if(JSON.stringify({sources,previous}).length>100000)throw Error('CONTEXT_TOO_LARGE');
 return {sources,coverage,previous};
}

export async function generateReview(id:string){
 const claimed=await db.aiRun.updateMany({where:{id,state:'QUEUED'},data:{state:'RUNNING',errorCode:null}});if(!claimed.count)return;
 const run=await db.aiRun.findUniqueOrThrow({where:{id}});
 const started=Date.now();let providerMs:number|null=null,inputTokens:number|undefined,outputTokens:number|undefined,evidence:any=null;
 try{
  if(!aiAvailable())throw Error('AI_UNAVAILABLE');
  const actor=await db.user.findUniqueOrThrow({where:{id:run.userId}});await projectScope(db,run.projectId,actor,true);
  const context=await projectContext(run.projectId,run.userId,run.documentIds,id,run.contextOptions);
  const providerStarted=Date.now();
  const response=await requestAssistant(run.model,run.prompt,context);
  providerMs=Date.now()-providerStarted;
  if(!response.ok)throw Error(response.status===401||response.status===403?'PROVIDER_AUTH_FAILED':response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_FAILED');
  const raw:any=await response.json();providerMs=Date.now()-providerStarted;inputTokens=providerTokenCount(raw.usage?.input_tokens);outputTokens=providerTokenCount(raw.usage?.output_tokens);if(raw.status!=='completed')throw Error('INCOMPLETE_RESPONSE');
  if(raw.output?.some((o:any)=>o.content?.some((c:any)=>c.type==='refusal')))throw Error('PROVIDER_REFUSAL');
  const text=raw.output?.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
  const result=aiResult.parse(JSON.parse(text));
  evidence=checkEvidence(context.sources,result.citations,result.requirements,result.answer);
  if(!evidence.accepted)throw Error('INVALID_CITATION');
  if(!safeDiagram(result.wiki.mermaid))throw Error('UNSAFE_DIAGRAM');
  if(run.prompt.startsWith('[ARCHITECTURE]')&&(!result.wiki.mermaid.trim()||!result.wiki.content.trim()))throw Error('ARCHITECTURE_INCOMPLETE');
  await db.$transaction(async tx=>{
   const project=await projectScope(tx,run.projectId,actor,true);await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;await projectScope(tx,run.projectId,actor,true);
   await tx.aiRun.updateMany({where:{id,state:'RUNNING'},data:{state:'READY',result:{...result,context:context.coverage,sourceReferences:evidence.references},inputTokens,outputTokens,metrics:{latencyMs:Date.now()-started,providerLatencyMs:providerMs,citationTotal:evidence.total,citationsValid:evidence.valid,citationValidity:evidence.validity,markersValid:evidence.markersValid,verification:'exact_excerpt_match'}}});
  });
 }catch(e){const code=e instanceof AppError?e.code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'ASSISTANT_FAILED';await db.aiRun.updateMany({where:{id,state:'RUNNING'},data:{state:'FAILED',errorCode:code,inputTokens,outputTokens,metrics:{latencyMs:Date.now()-started,providerLatencyMs:providerMs,citationTotal:evidence?.total??null,citationsValid:evidence?.valid??null,citationValidity:evidence?.validity??null,markersValid:evidence?.markersValid??null,verification:'exact_excerpt_match'}}});}
}
