import {Router} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db} from '../../../packages/db';
import {projectScope} from './planning';
import {requireThat} from './errors';
import {storageAvailable,putPrivate,getPrivate,deletePrivate} from './storage';
export const knowledge=Router();
const wikiInput=z.object({title:z.string().trim().min(2).max(160),category:z.string().max(50).default('General'),content:z.string().max(50000),mermaid:z.string().max(10000).default('')});
async function writeScope(tx:any,p:string,actor:any){
 const project=await projectScope(tx,p,actor,true);
 await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${project.hackathon.workspaceId} FOR UPDATE`;
 await projectScope(tx,p,actor,true);return project;
}
async function audit(tx:any,project:any,actor:any,action:string,id:string){
 await tx.auditEvent.create({data:{workspaceId:project.hackathon.workspaceId,actorId:actor.id,action,targetId:id}});
 await tx.outboxEvent.create({data:{type:action,entityId:id}});
}
knowledge.get('/projects/:p/knowledge',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 const [folders,resources,documents]=await Promise.all([db.folder.findMany({where:{projectId:p},orderBy:{name:'asc'},take:100}),db.resource.findMany({where:{projectId:p},orderBy:{createdAt:'desc'},take:100,select:{id:true,title:true,url:true,folderId:true,fileName:true,size:true,state:true,createdAt:true,document:{select:{id:true,state:true,errorCode:true}}}}),db.document.findMany({where:{projectId:p},orderBy:{createdAt:'desc'},take:100,select:{id:true,title:true,state:true,errorCode:true,createdAt:true}})]);
 res.json({data:{folders,resources,documents,storageAvailable:storageAvailable(),scannerConfigured:false}});
});
knowledge.post('/projects/:p/folders',async(req,res)=>{
 const p=String(req.params.p),{name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);
 const folder=await db.$transaction(async tx=>{const project=await writeScope(tx,p,res.locals.actor);const folder=await tx.folder.create({data:{projectId:p,name}});await audit(tx,project,res.locals.actor,'folder.created',folder.id);return folder;});
 res.status(201).json({data:folder});
});
knowledge.post('/projects/:p/resources',async(req,res)=>{
 const p=String(req.params.p),body=z.object({title:z.string().trim().min(1).max(160),url:z.url().refine(v=>v.startsWith('https://'),'Use HTTPS.'),folderId:z.string().nullable().optional()}).parse(req.body);
 const resource=await db.$transaction(async tx=>{const project=await writeScope(tx,p,res.locals.actor);if(body.folderId)requireThat(await tx.folder.findFirst({where:{id:body.folderId,projectId:p}}),422,'INVALID_FOLDER','Folder is outside this project.');const resource=await tx.resource.create({data:{...body,projectId:p,creatorId:res.locals.actor.id}});await audit(tx,project,res.locals.actor,'resource.created',resource.id);return resource;});
 res.status(201).json({data:resource});
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2}});
knowledge.post('/projects/:p/files',async(req,_res,next)=>{
 try{await projectScope(db,String(req.params.p),_res.locals.actor,true);requireThat(storageAvailable(),503,'STORAGE_UNAVAILABLE','Private file storage is not configured. You can paste requirements instead.');next();}catch(e){next(e);}
},upload.single('file'),async(req,res)=>{
 const p=String(req.params.p),file=req.file;requireThat(file,422,'FILE_REQUIRED','Choose a file.');
 const name=file.originalname.replace(/[^a-zA-Z0-9 ._-]/g,'_').slice(0,150),extension=name.split('.').at(-1)?.toLowerCase();
 let type:string;
 if(extension==='pdf'&&file.buffer.subarray(0,5).toString()==='%PDF-')type='application/pdf';
 else if(extension==='docx'&&file.buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 else if(extension==='txt'&&!file.buffer.includes(0)){try{new TextDecoder('utf-8',{fatal:true}).decode(file.buffer);type='text/plain';}catch{requireThat(false,422,'INVALID_TEXT','Upload valid UTF-8 text.');}}
 else {requireThat(false,422,'UNSUPPORTED_FILE','Upload a valid PDF, DOCX or UTF-8 TXT file. Legacy DOC requires conversion.');}
 const objectKey='projects/'+p+'/'+randomUUID();
 await putPrivate(objectKey,file.buffer,type);
 const resource=await db.$transaction(async tx=>{
  const project=await writeScope(tx,p,res.locals.actor);
  const folderId=req.body.folderId||null;if(folderId)requireThat(await tx.folder.findFirst({where:{id:folderId,projectId:p}}),422,'INVALID_FOLDER','Folder is outside this project.');
  const resource=await tx.resource.create({data:{projectId:p,folderId,title:name,fileName:name,objectKey,contentType:type,size:file.size,checksum:createHash('sha256').update(file.buffer).digest('hex'),state:'VALIDATED_UNSCANNED',creatorId:res.locals.actor.id,document:{create:{projectId:p,title:name,creatorId:res.locals.actor.id}}}});
  await audit(tx,project,res.locals.actor,'file.uploaded',resource.id);return resource;
 }).catch(async error=>{await deletePrivate(objectKey).catch(()=>{});throw error;});res.status(201).json({data:{id:resource.id,state:resource.state}});
});
knowledge.get('/files/:id/download',async(req,res)=>{
 const resource=await db.resource.findUnique({where:{id:String(req.params.id)}});
 requireThat(resource?.objectKey,404,'NOT_FOUND','File not found.');await projectScope(db,resource.projectId,res.locals.actor);
 res.json({data:{url:'/api/v1/files/'+resource.id+'/content',scanState:resource.state}});
});
knowledge.get('/files/:id/content',async(req,res)=>{
 const resource=await db.resource.findUnique({where:{id:String(req.params.id)}});requireThat(resource?.objectKey,404,'NOT_FOUND','File not found.');await projectScope(db,resource.projectId,res.locals.actor);
 const bytes=await getPrivate(resource.objectKey);await projectScope(db,resource.projectId,res.locals.actor);
 res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="'+(resource.fileName??'download').replace(/[^a-zA-Z0-9._-]/g,'_')+'"');res.send(bytes);
});
knowledge.post('/projects/:p/documents',async(req,res)=>{
 const p=String(req.params.p),body=z.object({title:z.string().min(2).max(160),text:z.string().trim().min(20).max(50000)}).parse(req.body);
 const document=await db.$transaction(async tx=>{
  const project=await writeScope(tx,p,res.locals.actor);
  const chunks=[];for(let offset=0;offset<body.text.length;offset+=3000)chunks.push({section:'Section '+(chunks.length+1),text:body.text.slice(offset,offset+3000)});
  const document=await tx.document.create({data:{projectId:p,title:body.title,state:'READY',creatorId:res.locals.actor.id,chunks:{create:chunks}}});await audit(tx,project,res.locals.actor,'document.created',document.id);return document;
 });res.status(201).json({data:document});
});
knowledge.get('/documents/:id',async(req,res)=>{
 const document=await db.document.findUnique({where:{id:String(req.params.id)},include:{chunks:true}});requireThat(document,404,'NOT_FOUND','Document not found.');await projectScope(db,document.projectId,res.locals.actor);res.json({data:document});
});
knowledge.get('/projects/:p/wiki',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 const input=z.object({cursor:z.string().optional(),search:z.string().max(100).optional()}).parse(req.query);
 const items=await db.wikiPage.findMany({where:{projectId:p,...(input.search?{title:{contains:input.search,mode:'insensitive'}}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 res.json({items:items.slice(0,50),nextCursor:items.length>50?items[49].id:null});
});
knowledge.post('/projects/:p/wiki',async(req,res)=>{
 const p=String(req.params.p),body=wikiInput.parse(req.body);
 const page=await db.$transaction(async tx=>{
  const project=await writeScope(tx,p,res.locals.actor);const page=await tx.wikiPage.create({data:{...body,projectId:p,authorId:res.locals.actor.id,authorName:res.locals.actor.name}});
  await tx.wikiRevision.create({data:{pageId:page.id,version:1,title:body.title,content:body.content,mermaid:body.mermaid,authorId:res.locals.actor.id,authorName:res.locals.actor.name}});await audit(tx,project,res.locals.actor,'wiki.created',page.id);return page;
 });res.status(201).json({data:page});
});
knowledge.get('/wiki/:id/revisions',async(req,res)=>{
 const page=await db.wikiPage.findUnique({where:{id:String(req.params.id)}});requireThat(page,404,'NOT_FOUND','Page not found.');await projectScope(db,page.projectId,res.locals.actor);
 res.json({items:await db.wikiRevision.findMany({where:{pageId:page.id},orderBy:{version:'desc'},take:100}),nextCursor:null});
});
knowledge.patch('/wiki/:id',async(req,res)=>{
 const id=String(req.params.id),{expectedVersion,...body}=wikiInput.extend({expectedVersion:z.number().int().positive()}).parse(req.body);
 const page=await db.$transaction(async tx=>{
  const existing=await tx.wikiPage.findUnique({where:{id}});requireThat(existing,404,'NOT_FOUND','Page not found.');const project=await writeScope(tx,existing.projectId,res.locals.actor);
  const update=await tx.wikiPage.updateMany({where:{id,version:expectedVersion},data:{...body,version:{increment:1},authorId:res.locals.actor.id,authorName:res.locals.actor.name}});
  requireThat(update.count,409,'CONFLICT','Someone updated this page. Your draft is preserved. Reload before saving.');
  const result=await tx.wikiPage.findUniqueOrThrow({where:{id}});
  await tx.wikiRevision.create({data:{pageId:id,version:result.version,title:body.title,content:body.content,mermaid:body.mermaid,authorId:res.locals.actor.id,authorName:res.locals.actor.name}});await audit(tx,project,res.locals.actor,'wiki.updated',id);return result;
 });res.json({data:page});
});
knowledge.post('/wiki/:id/restore',async(req,res)=>{
 const id=String(req.params.id),body=z.object({revision:z.number().int().positive(),expectedVersion:z.number().int().positive()}).parse(req.body);
 const result=await db.$transaction(async tx=>{
  const page=await tx.wikiPage.findUnique({where:{id}});requireThat(page,404,'NOT_FOUND','Page not found.');const project=await writeScope(tx,page.projectId,res.locals.actor);
  const revision=await tx.wikiRevision.findUnique({where:{pageId_version:{pageId:id,version:body.revision}}});requireThat(revision,404,'NOT_FOUND','Revision not found.');
  const data={title:revision.title,content:revision.content,mermaid:revision.mermaid,authorId:res.locals.actor.id,authorName:res.locals.actor.name};
  const updated=await tx.wikiPage.updateMany({where:{id,version:body.expectedVersion},data:{...data,version:{increment:1}}});requireThat(updated.count,409,'CONFLICT','Page changed. Refresh before restoring.');
  await tx.wikiRevision.create({data:{...data,pageId:id,version:body.expectedVersion+1}});await audit(tx,project,res.locals.actor,'wiki.restored',id);return {restored:true};
 });res.json({data:result});
});

knowledge.get('/projects/:p/documents/:id',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 const document=await db.document.findFirst({where:{id:String(req.params.id),projectId:p},include:{chunks:{orderBy:[{section:'asc'},{id:'asc'}]}}});requireThat(document,404,'NOT_FOUND','Document not found in this project.');res.json({data:document});
});
knowledge.get('/projects/:p/wiki/:id',async(req,res)=>{
 const p=String(req.params.p);await projectScope(db,p,res.locals.actor);
 const page=await db.wikiPage.findFirst({where:{id:String(req.params.id),projectId:p}});requireThat(page,404,'NOT_FOUND','Wiki page not found in this project.');res.json({data:page});
});
