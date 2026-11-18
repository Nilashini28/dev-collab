import { z } from 'zod';
import { mkdirSync,writeFileSync } from 'node:fs';
import * as s from '../packages/contracts';
const paths:Record<string,unknown>={};
const add=(path:string,method:string,body?:z.ZodType)=>{
  paths['/api/v1'+path]={...paths['/api/v1'+path] as object,[method]:{
    summary:method.toUpperCase()+' '+path,security:[{sessionCookie:[]}],
    parameters:[...path.matchAll(/\{([^}]+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string'}})),
    ...(body?{requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(body)}}}}:{}),
    responses:{'200':{description:'Authorized result'},'401':{description:'Sign in required'},'403':{description:'Forbidden'},'409':{description:'Version or state conflict'},'422':{description:'Invalid input'}},
  }};
};
add('/me','get');add('/workspaces','get');add('/workspaces','post',s.workspaceInput);add('/workspaces/{w}','get');
add('/workspaces/{w}/members','get');add('/workspaces/{w}/members/{u}','patch',s.memberInput);add('/workspaces/{w}/members/{u}','delete',s.versionInput);
add('/workspaces/{w}/ownership-transfer','post',s.transferInput);
add('/workspaces/{w}/invitations','get');add('/workspaces/{w}/invitations','post',s.invitationInput);add('/workspaces/{w}/invitations/{i}/resend','post');add('/workspaces/{w}/invitations/{i}','delete');
add('/invitations/preview','post',s.tokenInput);add('/invitations/accept','post',s.tokenInput);
add('/workspaces/{w}/join-links','get');add('/workspaces/{w}/join-links','post',s.linkInput);add('/workspaces/{w}/join-links/{i}','delete');add('/join-links/accept','post',s.tokenInput);
add('/workspaces/{w}/join-requests','get');add('/workspaces/{w}/join-requests/{i}/decision','post',s.decisionInput);
mkdirSync('docs',{recursive:true});
writeFileSync('docs/openapi.json',JSON.stringify({openapi:'3.1.0',info:{title:'DevCollab Stage 1',version:'0.1.0'},paths,components:{securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'better-auth.session_token'}}}},null,2));
console.log('Wrote docs/openapi.json');
