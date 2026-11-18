import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {db} from '../../../packages/db';
import {getPrivate} from '../../api/src/storage';
export function parseDocument(buffer:Buffer,type:string):Promise<string>{return new Promise((resolveText,reject)=>{
 const child=spawn(process.execPath,['--max-old-space-size=192',resolve('scripts/parse-document.mjs'),type],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
 let output='';const timer=setTimeout(()=>{child.kill();reject(Error('PARSE_TIMEOUT'));},20000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1200000){child.kill();reject(Error('OUTPUT_LIMIT'));}});
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('UNREADABLE_DOCUMENT'));try{resolveText(JSON.parse(output).text);}catch{reject(Error('UNREADABLE_DOCUMENT'));}});
 child.stdin.on('error',()=>{});child.stdin.end(buffer);
});}
export async function ingestDocument(id:string){
 const document=await db.document.findUnique({where:{id},include:{resource:true}});if(!document||document.state!=='QUEUED'||!document.resource?.objectKey)return;
 try{
  const text=(await parseDocument(await getPrivate(document.resource.objectKey),document.resource.contentType!)).trim();
  if(text.length<20){await db.document.update({where:{id},data:{state:'NEEDS_READABLE_TEXT',errorCode:'NO_READABLE_TEXT'}});return;}
  const chunks:{documentId:string;section:string;text:string}[]=[];for(let i=0;i<text.length;i+=3000)chunks.push({documentId:id,section:'Section '+(chunks.length+1),text:text.slice(i,i+3000)});
  await db.$transaction(async tx=>{await tx.documentChunk.deleteMany({where:{documentId:id}});await tx.documentChunk.createMany({data:chunks});await tx.document.update({where:{id},data:{state:'READY',errorCode:null}});});
 }catch{await db.document.update({where:{id},data:{state:'FAILED',errorCode:'EXTRACTION_FAILED_PASTE_TEXT'}});}
}

