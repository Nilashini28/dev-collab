import {summarizeReviews} from './pull-review';
import {createSign,createHmac,timingSafeEqual} from 'node:crypto';
import express from 'express';
import {z} from 'zod';
import {db} from '../../../packages/db';
import {projectScope} from './planning';
import {requireThat,AppError} from './errors';
export const github=express.Router();
export const githubAvailable=()=>!!(process.env.GITHUB_APP_ID&&process.env.GITHUB_PRIVATE_KEY&&process.env.GITHUB_WEBHOOK_SECRET);
function jwt(){
 const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:process.env.GITHUB_APP_ID})).toString('base64url');
 const value=header+'.'+payload,signer=createSign('RSA-SHA256');signer.update(value);return value+'.'+signer.sign(process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g,'\n'),'base64url');
}
export async function gh(path:string,token:string,method='GET',body?:unknown){
 const response=await fetch('https://api.github.com'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'DevCollab','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 if(!response.ok){
  const detail=[403,409].includes(response.status)?await response.clone().json().catch(()=>({})):{};
  if(response.status===409&&path.includes('/commits?')&&detail.message==='Git Repository is empty.')return [];
  if(response.status===429||(response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after')||/rate limit/i.test(detail.message??'')))){
   const reset=Number(response.headers.get('x-ratelimit-reset'))*1000,retry=Number(response.headers.get('retry-after'))*1000;
   throw new Error('RATE_LIMITED_'+Math.max(Date.now()+60000,Number.isFinite(reset)?reset:0,Date.now()+(Number.isFinite(retry)?retry:0)));
  }
  throw new AppError(response.status===404?403:502,'GITHUB_'+response.status,'GitHub could not authorize or complete this request. Check the installation and repository permissions.');
 }
 return response.json() as Promise<any>;
}
async function installationToken(installationId:number){
 const result=await gh('/app/installations/'+installationId+'/access_tokens',jwt(),'POST',{});return result.token as string;
}
function allowedInstallation(workspaceId:string,id:number){
 try{const map=JSON.parse(process.env.GITHUB_WORKSPACE_INSTALLATIONS_JSON??'{}');return Array.isArray(map[workspaceId])&&map[workspaceId].includes(id);}catch{return false;}
}
github.get('/projects/:p/repository',async(req,res)=>{
 const project=await projectScope(db,String(req.params.p),res.locals.actor);
 const input=z.object({page:z.coerce.number().int().min(1).max(20).default(1),status:z.enum(['ALL','OPEN','CLOSED','MERGED']).default('ALL')}).parse(req.query);
 const connection=await db.repositoryConnection.findUnique({where:{projectId:project.id},include:{commits:{orderBy:[{committedAt:'desc'},{id:'desc'}],skip:(input.page-1)*25,take:25},pulls:{where:input.status==='ALL'?{}:{state:input.status},orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(input.page-1)*25,take:25}}});
 const summary=connection?await Promise.all([
  db.gitCommit.count({where:{connectionId:connection.id}}),db.gitPullRequest.groupBy({by:['state'],where:{connectionId:connection.id},_count:true}),
  db.gitCommit.groupBy({by:['author'],where:{connectionId:connection.id},_count:true}),db.gitPullRequest.groupBy({by:['author'],where:{connectionId:connection.id},_count:true})
 ]):null;
 const contributors=new Map<string,{author:string;commits:number;pulls:number}>();
 if(summary){for(const row of summary[2])contributors.set(row.author,{author:row.author,commits:row._count,pulls:0});for(const row of summary[3]){const rowValue=contributors.get(row.author)??{author:row.author,commits:0,pulls:0};rowValue.pulls=row._count;contributors.set(row.author,rowValue);}}
 res.json({data:{configured:githubAvailable(),publicAvailable:true,connection,page:input.page,summary:summary?{commits:summary[0],pulls:summary[1].reduce((n,r)=>n+r._count,0),states:summary[1],contributors:[...contributors.values()].sort((a,b)=>a.author.localeCompare(b.author))}:null}});
});
github.post('/projects/:p/repository',async(req,res)=>{
 const project=await projectScope(db,String(req.params.p),res.locals.actor,true,true);
 const body=z.object({installationId:z.number().int().min(0).default(0),immediate:z.boolean().default(false),fullName:z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)}).parse(req.body);
 if(body.installationId)requireThat(githubAvailable(),503,'GITHUB_UNAVAILABLE','Configure the GitHub App for private repositories, or choose a public repository.');
 requireThat(!body.installationId||allowedInstallation(project.hackathon.workspaceId,body.installationId),403,'INSTALLATION_NOT_APPROVED','This installation is not approved for this workspace.');
 const token=body.installationId?await installationToken(body.installationId):'';
 const repo=await gh('/repos/'+body.fullName,token);
 if(!body.installationId)requireThat(repo.private===false,403,'PUBLIC_REPOSITORY_REQUIRED','This repository is not public. Configure an approved GitHub App to read private repositories.');
 requireThat(repo.permissions?.pull!==false,403,'REPOSITORY_FORBIDDEN','The installation cannot read this repository.');
 // Confirm explicit repository selection for this installation.
 let selected=!body.installationId;
 for(let page=1;body.installationId&&page<=20;page++){
  const result=await gh('/installation/repositories?per_page=100&page='+page,token);
  if(result.repositories.some((r:any)=>r.id===repo.id)){selected=true;break;}
  if(result.repositories.length<100)break;
 }
 requireThat(selected,403,'REPOSITORY_FORBIDDEN','Repository is not selected for this installation.');
 const connection=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;
  await projectScope(tx,project.id,res.locals.actor,true,true);
  const previous=await tx.repositoryConnection.findUnique({where:{projectId:project.id}});
  requireThat(!previous||previous.state==='DISCONNECTED'||previous.repositoryId===repo.id,409,'REPOSITORY_ALREADY_LINKED','Disconnect the existing repository before changing it.');
  if(previous?.state==='DISCONNECTED'){
   await tx.gitCommit.deleteMany({where:{connectionId:previous.id}});await tx.gitPullRequest.deleteMany({where:{connectionId:previous.id}});await tx.repositoryConnection.delete({where:{id:previous.id}});
  }
  const result=await tx.repositoryConnection.upsert({where:{projectId:project.id},create:{projectId:project.id,installationId:body.installationId,repositoryId:repo.id,fullName:repo.full_name,url:repo.html_url,branch:repo.default_branch},update:{installationId:body.installationId,fullName:repo.full_name,url:repo.html_url,branch:repo.default_branch,state:'QUEUED',errorCode:null}});
  await tx.outboxEvent.create({data:{type:'github.sync.queued',entityId:result.id}});return result;
 });
 if(!connection.installationId||body.immediate)await syncRepository(connection.id,true);
 res.status(202).json({data:await db.repositoryConnection.findUnique({where:{id:connection.id}})});
});
github.post('/projects/:p/repository/sync',async(req,res)=>{
 const {immediate}=z.object({immediate:z.boolean().default(false)}).parse(req.body??{});
 const project=await projectScope(db,String(req.params.p),res.locals.actor,true,true);
 const result=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;
  await projectScope(tx,project.id,res.locals.actor,true,true);
  const connection=await tx.repositoryConnection.findUnique({where:{projectId:project.id}});requireThat(connection&&connection.state!=='DISCONNECTED',409,'NOT_CONNECTED','Connect a repository first.');
  requireThat(!connection.installationId||githubAvailable(),503,'GITHUB_UNAVAILABLE','Configure the GitHub App first.');
  requireThat(!connection.installationId||allowedInstallation(project.hackathon.workspaceId,connection.installationId),403,'INSTALLATION_REVOKED','The installation is no longer approved.');
  const retryAt=Number(connection.errorCode?.replace('RATE_LIMITED_',''));
  requireThat(!retryAt||retryAt<=Date.now(),429,'GITHUB_RATE_LIMIT','GitHub rate limit reached. Retry after '+new Date(retryAt||Date.now()).toISOString());
  await tx.repositoryConnection.update({where:{id:connection.id},data:{state:'QUEUED',errorCode:null}});return connection;
 });
 if(!result.installationId||immediate)await syncRepository(result.id,true);
 res.status(202).json({data:await db.repositoryConnection.findUnique({where:{id:result.id}})});
});
github.delete('/projects/:p/repository',async(req,res)=>{
 const project=await projectScope(db,String(req.params.p),res.locals.actor,true,true);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;
  await projectScope(tx,project.id,res.locals.actor,true,true);
  await tx.repositoryConnection.updateMany({where:{projectId:project.id},data:{state:'DISCONNECTED',errorCode:null}});
 });res.json({data:{disconnected:true}});
});

export const githubWebhook=express.Router();
githubWebhook.post('/',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
 if(!process.env.GITHUB_WEBHOOK_SECRET||!Buffer.isBuffer(req.body)){res.sendStatus(503);return;}
 const signature=req.get('x-hub-signature-256')??'',expected='sha256='+createHmac('sha256',process.env.GITHUB_WEBHOOK_SECRET).update(req.body).digest('hex');
 if(!/^sha256=[a-f0-9]{64}$/.test(signature)||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))){res.sendStatus(401);return;}
 const deliveryId=req.get('x-github-delivery'),event=req.get('x-github-event');
 if(!deliveryId||deliveryId.length>128||!event||event.length>80){res.sendStatus(400);return;}
 let payload:any;try{payload=JSON.parse(req.body.toString());}catch{res.sendStatus(400);return;}
 if(!payload||typeof payload!=='object'||(payload.installation?.id!==undefined&&!Number.isSafeInteger(payload.installation.id))||(payload.repository?.id!==undefined&&!Number.isSafeInteger(payload.repository.id))){res.sendStatus(400);return;}
 await db.$transaction(async tx=>{
  const inserted=await tx.githubDelivery.createMany({data:[{id:deliveryId,event,installationId:payload.installation?.id,repositoryId:payload.repository?.id,state:['push','pull_request','pull_request_review','installation_repositories'].includes(event)?'QUEUED':'PROCESSED'}],skipDuplicates:true});
  if(!inserted.count)return;
  if(event==='installation'&&['deleted','suspend'].includes(payload.action)&&payload.installation?.id)await tx.repositoryConnection.updateMany({where:{installationId:payload.installation.id,state:{not:'DISCONNECTED'}},data:{state:'REVOKED',errorCode:'INSTALLATION_REVOKED'}});
  if(event==='installation_repositories'&&payload.action==='removed'&&payload.installation?.id){
   const ids=Array.isArray(payload.repositories_removed)?payload.repositories_removed.map((r:any)=>r.id).filter(Number.isSafeInteger):[];
   await tx.repositoryConnection.updateMany({where:{installationId:payload.installation.id,repositoryId:{in:ids},state:{not:'DISCONNECTED'}},data:{state:'REVOKED',errorCode:'REPOSITORY_REMOVED'}});
  }
 });
 res.status(202).json({received:true});
});
export async function syncRepository(id:string,finalAttempt=false){
 const connection=await db.repositoryConnection.findUnique({where:{id},include:{project:{include:{hackathon:true}}}});
 if(!connection||connection.state!=='QUEUED')return;
 if(connection.project.hackathon.archivedAt||(connection.installationId&&(!githubAvailable()||!allowedInstallation(connection.project.hackathon.workspaceId,connection.installationId)))){await db.repositoryConnection.updateMany({where:{id,state:'QUEUED'},data:{state:'UNAVAILABLE',errorCode:connection.project.hackathon.archivedAt?'PROJECT_ARCHIVED':'CONFIGURATION_REQUIRED'}});return;}
 try{
  const token=connection.installationId?await installationToken(connection.installationId):'';
  if(!connection.installationId){const repo=await gh('/repos/'+connection.fullName,token);if(repo.private!==false)throw new AppError(403,'GITHUB_403','Public repository access was removed.');}
  const commits:any[]=[],pulls:any[]=[];
  // Collect a bounded snapshot before publishing any of it.
  for(let page=1;page<=5;page++){
   const rows=await gh('/repos/'+connection.fullName+'/commits?per_page=100&page='+page,token);commits.push(...rows);if(rows.length<100)break;
  }
  for(let page=1;page<=5;page++){
   const rows=await gh('/repos/'+connection.fullName+'/pulls?state=all&sort=updated&direction=desc&per_page=100&page='+page,token);pulls.push(...rows);if(rows.length<100)break;
  }
  // Fetch review evidence only for explicitly linked PRs, never infer approval from merge state.
  const linked=await db.taskPullLink.findMany({where:{pull:{connectionId:id}},select:{number:true}});
  const reviews=new Map<number,string>();
  for(const number of new Set(linked.map(row=>row.number))){if(!pulls.some(pull=>pull.number===number))pulls.push(await gh('/repos/'+connection.fullName+'/pulls/'+number,token));}
  for(const number of new Set(linked.map(row=>row.number))){
   const rows:any[]=[];let complete=false;
   for(let page=1;page<=5;page++){const batch=await gh('/repos/'+connection.fullName+'/pulls/'+number+'/reviews?per_page=100&page='+page,token);rows.push(...batch);if(batch.length<100){complete=true;break;}}
   reviews.set(number,complete?summarizeReviews(rows):'UNKNOWN');
  }
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${connection.project.hackathon.workspaceId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${id} FOR UPDATE`;
   const current=await tx.repositoryConnection.findUnique({where:{id},include:{project:{include:{hackathon:true}}}});
   if(!current||current.installationId!==connection.installationId||current.repositoryId!==connection.repositoryId||current.state!=='QUEUED'||current.project.hackathon.archivedAt||(current.installationId&&!allowedInstallation(current.project.hackathon.workspaceId,current.installationId)))return;
   for(const commit of commits)await tx.gitCommit.upsert({where:{connectionId_sha:{connectionId:id,sha:commit.sha}},create:{connectionId:id,sha:commit.sha,title:commit.commit.message.split('\n')[0],author:commit.author?.login??commit.commit.author?.name??'Unknown',url:commit.html_url,committedAt:new Date(commit.commit.author.date)},update:{}});
   const touched=new Set<string>();
   for(const pull of pulls){
    const review=reviews.get(pull.number);
    const data={title:pull.title,author:pull.user.login,state:pull.merged_at?'MERGED':pull.state.toUpperCase(),url:pull.html_url,updatedAt:new Date(pull.updated_at),...(review?{reviewState:review,reviewedAt:new Date()}:{})};
    const stored=await tx.gitPullRequest.upsert({where:{connectionId_number:{connectionId:id,number:pull.number}},create:{connectionId:id,number:pull.number,...data},update:data});
    const links=await tx.taskPullLink.findMany({where:{pullId:stored.id},include:{task:true}});
    for(const link of links){touched.add(link.taskId);
     if(link.state!==stored.state||link.reviewState!==stored.reviewState){
      await tx.taskPullLink.update({where:{id:link.id},data:{title:stored.title,state:stored.state,reviewState:stored.reviewState}});
      await tx.taskHistory.create({data:{taskId:link.taskId,actorId:'github-sync',changes:{reason:'traceability.synced',pull:{url:stored.url,number:stored.number,state:stored.state,reviewState:stored.reviewState}}}});
     }
    }
   }
   for(const taskId of touched){
    const task=await tx.task.findUniqueOrThrow({where:{id:taskId},include:{pullLinks:{include:{pull:true}}}});
    // Frozen/completed sprints and historical/orphaned links never auto-complete.
    const sprint=task.sprintId?await tx.sprint.findUnique({where:{id:task.sprintId}}):null;
    if(task.autoCompleteOnMerge&&task.status!=='DONE'&&sprint?.status!=='COMPLETED'&&task.pullLinks.length&&task.pullLinks.every(link=>link.pull?.connectionId===id&&link.pull.state==='MERGED')){
     await tx.task.update({where:{id:taskId},data:{status:'DONE',version:{increment:1}}});
     await tx.taskHistory.create({data:{taskId,actorId:'github-sync',changes:{reason:'traceability.auto-completed',before:{status:task.status},after:{status:'DONE'}}}});
     await tx.auditEvent.create({data:{workspaceId:current.project.hackathon.workspaceId,actorId:'github-sync',action:'task.auto-completed',targetId:taskId}});
     await tx.outboxEvent.create({data:{type:'task.updated',entityId:taskId}});
    }
   }
   await tx.repositoryConnection.update({where:{id},data:{state:'READY',syncedAt:new Date(),errorCode:null}});
  },{timeout:30000});
 }catch(error){
  const code=error instanceof Error&&/^(GITHUB_\d+|RATE_LIMITED_\d+)$/.test(error.message)?error.message:error instanceof AppError?error.code:'SYNC_FAILED';
  const revoked=['GITHUB_401','GITHUB_403','GITHUB_404'].includes(code),limited=code.startsWith('RATE_LIMITED_');
  await db.repositoryConnection.updateMany({where:{id,state:'QUEUED'},data:{state:limited?'RATE_LIMITED':revoked?'REVOKED':finalAttempt?'FAILED':'QUEUED',errorCode:code}});
  if(!revoked&&!limited&&!finalAttempt)throw new Error('GitHub sync retry required.');
 }
}
