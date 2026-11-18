import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes, randomUUID, generateKeyPairSync, createHmac } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { freePort } from '../scripts/test-port';
const origin='http://localhost:5173';
process.env.NODE_ENV='test';
process.env.APP_ORIGIN=origin;
process.env.DATABASE_URL='postgresql://postgres:test-only-password@localhost:55433/devcollab_test';
process.env.BETTER_AUTH_SECRET=randomBytes(32).toString('hex');
process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY=randomBytes(32).toString('hex');
process.env.EMAIL_PROVIDER='smtp';
let postgres:EmbeddedPostgres;
let app:typeof import('../apps/api/src/app').app;
let db:typeof import('../packages/db').db;
let service:typeof import('../apps/api/src/workspaces');
let decrypt:typeof import('../apps/api/src/email').decrypt;
type TestUser={id:string;email:string;name:string;cookie:string};
let owner:TestUser,admin:TestUser,member:TestUser,viewer:TestUser,outsider:TestUser,extra:TestUser;
let w:string;
const password='Test-only-password-123!';
async function user(name:string,verify=true):Promise<TestUser>{
  const email=name.toLowerCase()+'@example.test';
  const signup=await request(app).post('/api/auth/sign-up/email').set('Origin',origin).send({email,name,password,callbackURL:origin+'/workspaces'});
  expect(signup.status,JSON.stringify(signup.body)).toBe(200);
  if(verify){
    const deliveries=await db.emailDelivery.findMany({where:{encryptedPayload:{not:null}},orderBy:{createdAt:'desc'}});
    const mail=deliveries.map(d=>decrypt(d.encryptedPayload!)).find(m=>m.to===email)!;
    const url=new URL(mail.text.split(' ').at(-1)!);
    const verified=await request(app).get(url.pathname+url.search);
    expect([200,302]).toContain(verified.status);
    expect((await db.user.findUniqueOrThrow({where:{email}})).emailVerified).toBe(true);
  }
  const login=await request(app).post('/api/auth/sign-in/email').set('Origin',origin).send({email,password});
  if(verify)expect(login.status,JSON.stringify(login.body)).toBe(200);
  const row=await db.user.findUniqueOrThrow({where:{email}});
  const cookies=login.headers['set-cookie'] as unknown as string[]|undefined;
  return {...row,cookie:(cookies??[]).map(c=>c.split(';')[0]).join('; ')};
}
const call=(u:TestUser,method:'get'|'post'|'patch'|'delete',path:string,body?:unknown)=>{
  const req=request(app)[method]('/api/v1'+path).set('Origin',origin).set('Cookie',u.cookie);
  return body?req.send(body):req;
};
beforeAll(async()=>{
  const port=await freePort();
  process.env.DATABASE_URL='postgresql://postgres:test-only-password@127.0.0.1:'+port+'/devcollab_test';
  const dir=resolve('.local','test-'+randomUUID());await mkdir(dir,{recursive:true});
  postgres=new EmbeddedPostgres({initdbFlags:['--encoding=UTF8','--locale=C'],databaseDir:dir,user:'postgres',password:'test-only-password',port,persistent:true,onLog:message=>{if(String(message).includes('FATAL'))console.error(message);},onError:()=>{}});
  await postgres.initialise();await postgres.start();await postgres.createDatabase('devcollab_test');
  const client=postgres.getPgClient('devcollab_test');await client.connect();
  for(const migration of (await readdir('packages/db/migrations')).filter(n=>n.startsWith('2026')).sort()) await client.query(await readFile('packages/db/migrations/'+migration+'/migration.sql','utf8'));await client.end();
  ({app}=await import('../apps/api/src/app'));({db}=await import('../packages/db'));service=await import('../apps/api/src/workspaces');({decrypt}=await import('../apps/api/src/email'));
  owner=await user('Owner');admin=await user('Admin');member=await user('Member');viewer=await user('Viewer');outsider=await user('Outsider');extra=await user('Extra');
  const result=await call(owner,'post','/workspaces',{name:'Real test team'});expect(result.status).toBe(201);w=result.body.data.id;
},120000);
afterAll(async()=>{if(db)await db.$disconnect();if(postgres)await postgres.stop();},60000);
describe('Stage 1 with real PostgreSQL and Better Auth sessions',()=>{
 it('validates signup names on the server and does not replace existing accounts',async()=>{
   for(const name of [' ', 'A', 'x'.repeat(81)]){
     const response=await request(app).post('/api/auth/sign-up/email').set('Origin',origin).send({email:'invalid-'+randomUUID()+'@example.test',name,password});expect(response.status).toBe(400);
   }
   const before=await db.user.findUniqueOrThrow({where:{id:owner.id}});
   await request(app).post('/api/auth/sign-up/email').set('Origin',origin).send({email:owner.email,name:'Replacement',password});
   expect(await db.user.count({where:{email:owner.email}})).toBe(1);
   expect((await db.user.findUniqueOrThrow({where:{id:owner.id}})).name).toBe(before.name);
 });
 it('handles OAuth state, new sign-in and explicit matching account linking without implicit merging',async()=>{
  const {betterAuth}=await import('better-auth');const {auth}=await import('../apps/api/src/auth');
  let email=owner.email,verified=true,identity='google-fixture-owner';
  const oauth=betterAuth({...auth.options,socialProviders:{google:{clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-only',getUserInfo:async()=>({user:{name:'OAuth Fixture',email,emailVerified:verified},data:{sub:identity,aud:'fixture.apps.googleusercontent.com',azp:'fixture.apps.googleusercontent.com',email,email_verified:verified,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),iss:'https://accounts.google.com',name:'OAuth Fixture',given_name:'OAuth',family_name:'Fixture',picture:''}})}}});
  const invoke=(path:string,method='GET',body?:unknown,cookie='')=>oauth.handler(new Request(origin+'/api/auth'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  const start=async(link=false,cookie='')=>{const response=await invoke(link?'/link-social':'/sign-in/social','POST',{provider:'google',callbackURL:origin+'/account',errorCallbackURL:origin+'/account'},cookie);expect(response.status).toBe(200);const data=await response.json();const url=new URL(data.url);expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('redirect_uri')).toBe(origin+'/api/auth/callback/google');expect(url.searchParams.get('state')).toBeTruthy();return {state:url.searchParams.get('state')!,cookie:[cookie,...response.headers.getSetCookie().map(c=>c.split(';')[0])].filter(Boolean).join('; ')};};
  const finish=(flow:{state:string;cookie:string})=>invoke('/callback/google?code=fixture-code&state='+encodeURIComponent(flow.state),'GET',undefined,flow.cookie);
  vi.stubGlobal('fetch',async(input:any)=>{const url=typeof input==='string'?input:input.url??String(input);expect(url).toBe('https://oauth2.googleapis.com/token');return Response.json({access_token:'fixture-access-token',token_type:'Bearer',expires_in:3600});});
  try{
   expect((await invoke('/link-social','POST',{provider:'google'})).status).toBe(401);
   const missing=await invoke('/callback/google?code=fixture-code');expect(missing.headers.get('location')).toContain('state');
   const implicit=await finish(await start());expect(implicit.headers.get('location')).toContain('account_not_linked');expect(await db.account.count({where:{userId:owner.id,providerId:'google'}})).toBe(0);
   email='wrong-account@example.test';const mismatch=await finish(await start(true,owner.cookie));expect(mismatch.headers.get('location')).toMatch(/email.*match/);expect(await db.account.count({where:{userId:owner.id,providerId:'google'}})).toBe(0);
   email=owner.email;verified=false;const unverified=await finish(await start(true,owner.cookie));expect(unverified.headers.get('location')).toContain('unable_to_link_account');
   verified=true;const flow=await start(true,owner.cookie),linked=await finish(flow);expect(linked.headers.get('location')).toBe(origin+'/account');expect(await db.account.count({where:{userId:owner.id,providerId:'google'}})).toBe(1);expect((await finish(flow)).headers.get('location')).toMatch(/state/);
   const signedIn=await finish(await start());expect(signedIn.headers.get('location')).toBe(origin+'/account');expect(signedIn.headers.getSetCookie().some(c=>c.includes('session_token'))).toBe(true);
   identity='google-fixture-new';email='oauth-new@example.test';const created=await finish(await start());expect(created.headers.get('location')).toBe(origin+'/account');expect((await db.user.findUniqueOrThrow({where:{email}})).emailVerified).toBe(true);
  }finally{vi.unstubAllGlobals();}
 });

 it('previews workspace and role before acceptance without granting membership',async()=>{
   const link=await service.createLink(owner,w,{days:1,maxUses:1,requiresApproval:true});const token=link.url.split('#token=')[1];
   const response=await call(outsider,'post','/join-links/preview',{token});expect(response.status).toBe(200);expect(response.body.data).toMatchObject({workspaceName:'Real test team',role:'MEMBER',requiresApproval:true,state:'PENDING'});
   expect((await call(outsider,'get','/workspaces/'+w)).status).toBe(404);
   await service.revokeLink(owner,w,link.id);expect((await call(outsider,'post','/join-links/preview',{token})).body.data.state).toBe('REVOKED');
   expect((await request(app).post('/api/v1/join-links/preview').set('Origin',origin).send({token})).status).toBe(401);
 });
 it('preserves a pending invitation in an encrypted HTTP-only cookie and rejects tampering',async()=>{
   const link=await service.createLink(owner,w,{days:1,maxUses:2,requiresApproval:false});const token=link.url.split('#token=')[1];
   const saved=await request(app).post('/api/invitation-intent').set('Origin',origin).send({kind:'join',token});expect(saved.status).toBe(200);
   const header=(saved.headers['set-cookie'] as unknown as string[])[0];expect(header).toContain('HttpOnly');expect(header).not.toContain(token);
   const intent=header.split(';')[0];
   const preview=await request(app).post('/api/v1/join-links/preview').set('Origin',origin).set('Cookie',outsider.cookie+'; '+intent).send({});expect(preview.status).toBe(200);expect(preview.body.data.workspaceName).toBe('Real test team');
   const damaged=intent.slice(0,-10)+'xxxxxxxxxx';
   expect((await request(app).post('/api/v1/join-links/preview').set('Origin',origin).set('Cookie',outsider.cookie+'; '+damaged).send({})).status).toBe(400);
   expect((await request(app).post('/api/invitation-intent').set('Origin','https://other.example').send({kind:'join',token})).status).toBe(403);
 });
 it('keeps outsider records private and rejects cross-origin mutations',async()=>{
   expect((await call(outsider,'get','/workspaces/'+w)).status).toBe(404);
   expect((await call(outsider,'get','/workspaces')).body.items).toHaveLength(0);
   expect((await request(app).post('/api/v1/workspaces').set('Origin','https://evil.example').set('Cookie',owner.cookie).send({name:'Bad'})).status).toBe(403);
   expect((await request(app).get('/api/v1/workspaces')).status).toBe(401);
 });
 it('uses hashed email-bound invitations and rejects a wrong account',async()=>{
   const result=await call(owner,'post','/workspaces/'+w+'/invitations',{emails:[admin.email],role:'ADMIN'});
   expect(result.status).toBe(201);
   const delivery=await db.emailDelivery.findFirstOrThrow({where:{invitationId:result.body.data[0].id}});
   const mail=decrypt(delivery.encryptedPayload!);const raw=mail.text.split('#token=')[1];
   expect(delivery.encryptedPayload).not.toContain(raw);
   const stored=await db.invitation.findUniqueOrThrow({where:{id:result.body.data[0].id}});
   expect(stored.tokenHash).not.toBe(raw);
   expect((await call(outsider,'post','/invitations/preview',{token:raw})).status).toBe(403);
   expect((await call(admin,'post','/invitations/preview',{token:raw})).body.data).toMatchObject({workspaceName:'Real test team',role:'ADMIN',state:'PENDING'});
   expect((await call(outsider,'post','/invitations/accept',{token:raw})).status).toBe(403);
   expect((await call(admin,'post','/invitations/accept',{token:raw})).status).toBe(200);
   expect((await call(admin,'post','/invitations/accept',{token:raw})).status).toBe(200);
   expect(await db.membership.count({where:{workspaceId:w,userId:admin.id}})).toBe(1);
 });
 it('rejects concurrent duplicate invitations and invitations to current members',async()=>{
   const email='duplicate-invite@example.test';
   const results=await Promise.all([email,email.toUpperCase()].map(address=>call(owner,'post','/workspaces/'+w+'/invitations',{emails:[address],role:'MEMBER'})));
   expect(results.map(r=>r.status).sort()).toEqual([201,409]);
   expect(await db.invitation.count({where:{workspaceId:w,email}})).toBe(1);
   expect((await call(owner,'post','/workspaces/'+w+'/invitations',{emails:[owner.email],role:'MEMBER'})).status).toBe(409);
 });
 it('atomically limits concurrent joins and does not consume duplicate uses',async()=>{
   const link=await service.createLink(owner,w,{days:7,maxUses:1,requiresApproval:false});
   const raw=link.url.split('#token=')[1];
   const results=await Promise.allSettled([service.acceptLink(member,raw),service.acceptLink(viewer,raw)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   const winner=results[0].status==='fulfilled'?member:viewer;
   await service.acceptLink(winner,raw);
   expect((await db.joinLink.findUniqueOrThrow({where:{id:link.id}})).uses).toBe(1);
   const second=results[0].status==='fulfilled'?viewer:member;
   const l2=await service.createLink(owner,w,{days:7,maxUses:1,requiresApproval:false});await service.acceptLink(second,l2.url.split('#token=')[1]);
 });
 it('enforces viewer restrictions, admin hierarchy and stale-version conflicts',async()=>{
   let m=await db.membership.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:w,userId:viewer.id}}});
   await service.changeMember(owner,w,viewer.id,m.version,'VIEWER');
   expect((await call(viewer,'post','/workspaces/'+w+'/join-links',{days:7,maxUses:4,requiresApproval:false})).status).toBe(403);
   expect((await call(admin,'post','/workspaces/'+w+'/invitations',{emails:[extra.email],role:'ADMIN'})).status).toBe(403);
   expect((await call(admin,'patch','/workspaces/'+w+'/members/'+owner.id,{role:'MEMBER',expectedVersion:1})).status).toBe(403);
   expect((await call(owner,'patch','/workspaces/'+w+'/members/'+viewer.id,{role:'MEMBER',expectedVersion:m.version})).status).toBe(409);
 });
 it('holds approval requests outside membership until explicit approval',async()=>{
   const link=await service.createLink(owner,w,{days:7,maxUses:1,requiresApproval:true});
   const result=await service.acceptLink(extra,link.url.split('#token=')[1]);expect(result.state).toBe('PENDING');
   expect((await call(extra,'get','/workspaces/'+w)).status).toBe(404);
   const pending=await db.joinRequest.findUniqueOrThrow({where:{linkId_userId:{linkId:link.id,userId:extra.id}}});
   await service.decide(owner,w,pending.id,'APPROVED',pending.version);
   expect((await call(extra,'get','/workspaces/'+w)).status).toBe(200);
   expect(await db.membership.count({where:{workspaceId:w,active:true}})).toBe(5);
 });
 it('blocks revoked and expired links',async()=>{
   const revoked=await service.createLink(owner,w,{days:7,maxUses:1,requiresApproval:false});
   await service.revokeLink(owner,w,revoked.id);
   expect((await call(outsider,'post','/join-links/accept',{token:revoked.url.split('#token=')[1]})).status).toBe(410);
   const expired=await service.createLink(owner,w,{days:7,maxUses:1,requiresApproval:false});
   await db.joinLink.update({where:{id:expired.id},data:{expiresAt:new Date(0)}});
   expect((await call(outsider,'post','/join-links/accept',{token:expired.url.split('#token=')[1]})).status).toBe(410);
 });
 it('revokes access immediately and prevents a consumed link from rejoining',async()=>{
   const m=await db.membership.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:w,userId:extra.id}}});
   await service.changeMember(owner,w,extra.id,m.version);
   expect((await call(extra,'get','/workspaces/'+w+'/members')).status).toBe(404);
 });
 it('protects the last owner and transfers ownership atomically',async()=>{
   expect((await call(owner,'delete','/workspaces/'+w+'/members/'+owner.id,{expectedVersion:1})).status).toBe(403);
   const workspace=await db.workspace.findUniqueOrThrow({where:{id:w}});
   await service.transfer(owner,w,member.id,workspace.version);
   const owners=await db.membership.findMany({where:{workspaceId:w,role:'OWNER',active:true}});
   expect(owners.map(m=>m.userId)).toEqual([member.id]);
   expect((await db.membership.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:w,userId:owner.id}}})).role).toBe('ADMIN');
 });
 it('creates durable audits/outbox and never exposes token hashes in invitation lists',async()=>{
   const result=await call(member,'get','/workspaces/'+w+'/invitations');
   expect(result.status).toBe(200);expect(JSON.stringify(result.body)).not.toContain('tokenHash');
   expect(await db.auditEvent.count({where:{workspaceId:w}})).toBeGreaterThan(10);
   expect(await db.outboxEvent.count()).toBeGreaterThan(10);
 });
 it('rejects unverified login and expires sessions',async()=>{
   const unverified=await user('Unverified',false);
   expect(unverified.cookie).toBe('');
   const response=await request(app).post('/api/auth/sign-in/email').set('Origin',origin).send({email:unverified.email,password});
   expect(response.status).toBe(403);
   await db.session.updateMany({where:{userId:extra.id},data:{expiresAt:new Date(0)}});
   expect((await call(extra,'get','/workspaces')).status).toBe(401);
 });
 it('resends with a rotated token and rejects revoked invitations',async()=>{
   const sent=await service.invite(member,w,[outsider.email],'MEMBER');const invitationId=sent[0].id;
   const first=await db.emailDelivery.findFirstOrThrow({where:{invitationId}});
   const oldToken=decrypt(first.encryptedPayload!).text.split('#token=')[1];
   await db.invitation.update({where:{id:invitationId},data:{lastSentAt:new Date(0)}});
   await service.updateInvite(member,w,invitationId,true);
   expect((await call(outsider,'post','/invitations/accept',{token:oldToken})).status).toBe(404);
   const latest=await db.emailDelivery.findFirstOrThrow({where:{invitationId,state:'QUEUED'},orderBy:{createdAt:'desc'}});
   const newToken=decrypt(latest.encryptedPayload!).text.split('#token=')[1];
   expect(newToken).not.toBe(oldToken);
   await service.updateInvite(member,w,invitationId,false);
   expect((await call(outsider,'post','/invitations/accept',{token:newToken})).status).toBe(410);
   expect((await db.emailDelivery.findUniqueOrThrow({where:{id:latest.id}})).encryptedPayload).toBeNull();
 });
 it('resets passwords through the library and revokes existing sessions',async()=>{
   const response=await request(app).post('/api/auth/request-password-reset').set('Origin',origin).send({email:viewer.email,redirectTo:origin+'/reset-password'});
   expect(response.status).toBe(200);
   const deliveries=await db.emailDelivery.findMany({where:{encryptedPayload:{not:null}},orderBy:{createdAt:'desc'}});
   const mail=deliveries.map(d=>decrypt(d.encryptedPayload!)).find(m=>m.to===viewer.email&&m.subject.startsWith('Reset'))!;
   const url=new URL(mail.text.split(' ').at(-1)!);
   const resetToken=url.pathname.split('/').at(-1)!;
   const reset=await request(app).post('/api/auth/reset-password').set('Origin',origin).send({token:resetToken,newPassword:'Changed-test-password-123!'});
   expect(reset.status,JSON.stringify(reset.body)).toBe(200);
   expect((await call(viewer,'get','/workspaces')).status).toBe(401);
   expect((await request(app).post('/api/auth/sign-in/email').set('Origin',origin).send({email:viewer.email,password})).status).toBe(401);
   expect((await request(app).post('/api/auth/sign-in/email').set('Origin',origin).send({email:viewer.email,password:'Changed-test-password-123!'})).status).toBe(200);
 });
 it('logs out and invalidates the session',async()=>{
   const logout=await request(app).post('/api/auth/sign-out').set('Origin',origin).set('Cookie',outsider.cookie).send({});
   expect(logout.status).toBe(200);
   expect((await call(outsider,'get','/workspaces')).status).toBe(401);
 });
 it('persists hackathons and rejects foreign assignees and task edit conflicts',async()=>{
   const created=await call(member,'post','/workspaces/'+w+'/hackathons',{name:'Planning test',description:'A real database project'});
   expect(created.status).toBe(201);const p=created.body.data.project.id;
   const task=await call(admin,'post','/projects/'+p+'/tasks',{title:'Build the core',priority:'HIGH'});
   expect(task.status).toBe(201);
   expect((await call(admin,'patch','/tasks/'+task.body.data.id,{assigneeId:outsider.id,expectedVersion:1})).status).toBe(404);
   expect((await call(admin,'patch','/tasks/'+task.body.data.id,{status:'IN_PROGRESS',expectedVersion:1})).status).toBe(200);
   expect((await call(admin,'patch','/tasks/'+task.body.data.id,{status:'DONE',expectedVersion:1})).status).toBe(409);
   expect((await call(extra,'get','/projects/'+p)).status).toBe(401);
   const sprint=await call(member,'post','/projects/'+p+'/sprints',{name:'First sprint',goal:'Deliver the core',startAt:new Date().toISOString(),endAt:new Date(Date.now()+86400000).toISOString()});
   expect(sprint.status).toBe(201);
   await call(admin,'patch','/tasks/'+task.body.data.id,{sprintId:sprint.body.data.id,expectedVersion:2});
   const started=await call(member,'post','/sprints/'+sprint.body.data.id+'/start',{expectedVersion:1});expect(started.status).toBe(200);
   expect(started.body.data.scopeSnapshot).toHaveLength(1);
   const second=await call(member,'post','/projects/'+p+'/sprints',{name:'Second sprint',startAt:new Date().toISOString(),endAt:new Date(Date.now()+86400000).toISOString()});
   expect((await call(member,'post','/sprints/'+second.body.data.id+'/start',{expectedVersion:1})).status).toBe(409);
   const completed=await call(member,'post','/sprints/'+sprint.body.data.id+'/complete',{expectedVersion:2,unfinishedDestination:'BACKLOG'});
   expect(completed.status).toBe(200);expect(completed.body.data.summary.unfinished).toBe(1);
   expect((await db.task.findUniqueOrThrow({where:{id:task.body.data.id}})).sprintId).toBeNull();
 });
 it('isolates multiple event projects, rejects unauthorized edits and archives without deleting work',async()=>{
  const login=await request(app).post('/api/auth/sign-in/email').set('Origin',origin).send({email:viewer.email,password:'Changed-test-password-123!'});expect(login.status,JSON.stringify(login.body)).toBe(200);viewer.cookie=(login.headers['set-cookie'] as unknown as string[]).map(c=>c.split(';')[0]).join('; ');
  const payload={name:'Autumn challenge',description:'Event description',officialUrl:'https://example.test/event',startAt:'2027-01-01T10:00:00Z',endAt:'2027-01-01T18:00:00Z',timezone:'Asia/Kolkata',format:'OFFLINE',venue:'Main hall',participationDetails:'Bring your laptop'};
  expect((await call(viewer,'post','/workspaces/'+w+'/hackathons',payload)).status).toBe(403);
  const first=await call(member,'post','/workspaces/'+w+'/hackathons',payload),second=await call(member,'post','/workspaces/'+w+'/hackathons',{...payload,name:'Winter challenge',format:'ONLINE',venue:''});
  expect(first.status).toBe(201);expect(second.status).toBe(201);const h=first.body.data,p=h.project.id;
  expect(p).not.toBe(second.body.data.project.id);
  const details={name:'Independent build',description:'Project description',repositoryUrl:'https://example.test/repo',demoUrl:'https://example.test/demo',status:'BUILDING',expectedVersion:1};
  expect((await call(viewer,'patch','/projects/'+p+'/details',details)).status).toBe(403);
  expect((await call(member,'patch','/projects/'+p+'/details',details)).status).toBe(200);
  expect((await call(member,'patch','/projects/'+p+'/details',details)).status).toBe(409);
  expect((await db.project.findUniqueOrThrow({where:{id:second.body.data.project.id}})).name).toBe('Winter challenge');
  expect((await call(viewer,'patch','/workspaces/'+w+'/hackathons/'+h.id,{...payload,expectedVersion:1})).status).toBe(403);
  expect((await call(member,'patch','/workspaces/'+w+'/hackathons/'+h.id,{...payload,name:'Revised event',expectedVersion:1})).status).toBe(200);
  expect((await call(member,'patch','/workspaces/'+w+'/hackathons/'+h.id,{...payload,expectedVersion:1})).status).toBe(409);
  const foreign=await service.createWorkspace(member,'Other team');
  expect((await call(member,'delete','/workspaces/'+foreign.id+'/hackathons/'+h.id,{expectedVersion:2})).status).toBe(409);
  expect((await call(member,'delete','/workspaces/'+w+'/hackathons/'+h.id,{expectedVersion:2})).status).toBe(200);
  expect((await call(member,'get','/projects/'+p)).status).toBe(404);
  expect(await db.project.count({where:{id:p}})).toBe(1);
  expect((await call(member,'get','/workspaces/'+w+'/hackathons')).body.items.some((item:any)=>item.id===h.id)).toBe(false);
 });
 it('dispatches timezone-labelled event reminders once and excludes archived, past and removed members',async()=>{
  const {dispatchEventReminders}=await import('../apps/api/src/planning');const now=new Date('2028-01-01T00:00:00Z');
  const h=await db.hackathon.create({data:{workspaceId:w,name:'Reminder fixture',startAt:new Date(now.getTime()+3600000),timezone:'Asia/Kolkata'}});
  const archived=await db.hackathon.create({data:{workspaceId:w,name:'Archived fixture',startAt:new Date(now.getTime()+3600000),archivedAt:now}});
  const past=await db.hackathon.create({data:{workspaceId:w,name:'Past fixture',startAt:new Date(now.getTime()-3600000)}});
  await Promise.all([dispatchEventReminders(now),dispatchEventReminders(now)]);
  const rows=await db.notification.findMany({where:{sourceKey:{startsWith:'event:'+h.id+':'}}});
  expect(rows.length).toBe(await db.membership.count({where:{workspaceId:w,active:true}}));expect(rows[0].body).toContain('Asia/Kolkata');expect(rows.some(n=>n.userId===extra.id)).toBe(false);
  expect(await db.notification.count({where:{sourceKey:{startsWith:'event:'+archived.id+':'}}})).toBe(0);expect(await db.notification.count({where:{sourceKey:{startsWith:'event:'+past.id+':'}}})).toBe(0);
  await db.hackathon.update({where:{id:h.id},data:{startAt:new Date(now.getTime()+48*3600000),version:{increment:1}}});await dispatchEventReminders(now);expect(await db.notification.count({where:{sourceKey:{startsWith:'event:'+h.id+':2:'}}})).toBe(0);
 });
 it('validates invitation addresses and protects delivery status from unauthorized members',async()=>{
  expect((await call(member,'post','/workspaces/'+w+'/invitations',{emails:['bad address']})).status).toBe(422);
  expect((await call(viewer,'post','/workspaces/'+w+'/invitation-deliveries',{ids:[randomUUID()]})).status).toBe(403);
  const result=await call(member,'post','/workspaces/'+w+'/invitations',{emails:['  Flow@Test.Example  '],role:'MEMBER'});expect(result.status).toBe(201);const id=result.body.data[0].id;
  expect(result.body.data[0].email).toBe('flow@test.example');
  for(const state of ['QUEUED','PROVIDER_ACCEPTED','FAILED'] as const){await db.emailDelivery.updateMany({where:{invitationId:id},data:{state}});const check=await call(member,'post','/workspaces/'+w+'/invitation-deliveries',{ids:[id]});expect(check.body.items[0].state).toBe(state);expect(JSON.stringify(check.body)).not.toContain('encryptedPayload');}
 });
 it('keeps direct messages private and deduplicates retried sends',async()=>{
   const created=await call(member,'post','/workspaces/'+w+'/conversations',{kind:'DM',peerId:admin.id});expect(created.status).toBe(201);const c=created.body.data.id;
   const payload={body:'A private planning note',clientMessageId:randomUUID()};
   const first=await call(member,'post','/conversations/'+c+'/messages',payload);expect(first.status).toBe(201);
   const retry=await call(member,'post','/conversations/'+c+'/messages',payload);expect(retry.body.data.id).toBe(first.body.data.id);
   expect(await db.message.count({where:{conversationId:c}})).toBe(1);
   expect((await call(owner,'get','/conversations/'+c+'/messages')).status).toBe(404);
   expect((await call(admin,'get','/conversations/'+c+'/messages')).body.items).toHaveLength(1);
   expect((await call(member,'post','/conversations/'+c+'/messages',{...payload,body:'Different body'})).status).toBe(409);
 });
 it('versions wiki edits, restores history, and scopes source documents',async()=>{
   const p=(await db.project.findFirstOrThrow()).id;
   const doc=await call(admin,'post','/projects/'+p+'/documents',{title:'Challenge brief',text:'The prototype must support private student teams and shared tasks.'});expect(doc.status).toBe(201);
   expect((await call(admin,'get','/documents/'+doc.body.data.id)).body.data.chunks).toHaveLength(1);
   const created=await call(admin,'post','/projects/'+p+'/wiki',{title:'Architecture',content:'Original decision'});expect(created.status).toBe(201);const id=created.body.data.id;
   expect((await call(admin,'patch','/wiki/'+id,{title:'Architecture',content:'Updated decision',expectedVersion:1})).status).toBe(200);
   expect((await call(member,'patch','/wiki/'+id,{title:'Stale edit',content:'Must not overwrite',expectedVersion:1})).status).toBe(409);
   expect((await call(admin,'post','/wiki/'+id+'/restore',{revision:1,expectedVersion:2})).status).toBe(200);
   expect((await db.wikiPage.findUniqueOrThrow({where:{id}})).content).toBe('Original decision');
   expect((await call(admin,'get','/wiki/'+id+'/revisions')).body.items).toHaveLength(3);
   expect((await call(admin,'post','/projects/'+p+'/ai',{prompt:'Summarize the brief and create a plan',documentIds:[doc.body.data.id]})).status).toBe(503);
 });
 it('requires explicit AI approval and makes retries idempotent',async()=>{
   const p=(await db.project.findFirstOrThrow()).id;
   const run=await db.aiRun.create({data:{projectId:p,userId:admin.id,prompt:'Test review fixture',documentIds:[],model:'test-only',state:'READY',result:{}}});
   const body={tasks:[{title:'Reviewed task',description:'Human approved draft'}],wiki:null};
   const result=await call(admin,'post','/ai/'+run.id+'/approve',body);expect(result.status).toBe(200);
   const retry=await call(admin,'post','/ai/'+run.id+'/approve',body);expect(retry.body.data.id).toBe(result.body.data.id);
   expect(await db.task.count({where:{id:{in:result.body.data.taskIds}}})).toBe(1);
   expect((await call(member,'post','/ai/'+run.id+'/approve',body)).status).toBe(404);
   expect((await call(admin,'post','/ai/'+run.id+'/approve',{tasks:[{title:'Changed draft',description:''}],wiki:null})).status).toBe(409);
 });
 it('schedules versioned reminders and deduplicates in-app delivery',async()=>{
   const project=await db.project.findFirstOrThrow();
   const response=await request(app).put('/api/v1/projects/'+project.id+'/deadline').set('Origin',origin).set('Cookie',member.cookie).send({instant:new Date(Date.now()+48*3600000).toISOString(),timezone:'Asia/Kolkata',expectedVersion:0});
   expect(response.status).toBe(200);
   expect(await db.reminder.count({where:{deadlineId:response.body.data.id,state:'SCHEDULED'}})).toBe(3);
   await db.reminder.updateMany({where:{deadlineId:response.body.data.id,offsetHours:24},data:{scheduledAt:new Date(0)}});
   const {dispatchReminders}=await import('../apps/api/src/planning');await dispatchReminders();await dispatchReminders();
   const reminder=await db.reminder.findFirstOrThrow({where:{deadlineId:response.body.data.id,offsetHours:24}});
   const count=await db.notification.count({where:{sourceKey:reminder.id}});expect(count).toBe(4);
   const submission=await call(member,'post','/projects/'+project.id+'/submission',{status:'SUBMITTED',expectedVersion:1});expect(submission.status).toBe(200);
   expect(await db.reminder.count({where:{deadlineId:response.body.data.id,state:'SCHEDULED'}})).toBe(0);
 });
 it('keeps separate request budgets for teammates on the same IP',async()=>{
  const first=await user('BudgetOne'),second=await user('BudgetTwo');
  for(let i=0;i<180;i++)expect((await call(first,'get','/me')).status).toBe(200);
  expect((await call(first,'get','/me')).status).toBe(429);
  expect((await call(second,'get','/me')).status).toBe(200);
 });

 it('counts only other senders unread messages and keeps DM notifications private',async()=>{
  const leader=await user('ChatLeader'),peer=await user('ChatPeer'),stranger=await user('ChatStranger');const team=await service.createWorkspace(leader,'Unread test team');
  for(const who of [peer,stranger]){const link=await service.createLink(leader,team.id,{days:1,maxUses:1,requiresApproval:false});await service.acceptLink(who,link.url.split('#token=')[1]);}
  const group=await db.conversation.findFirstOrThrow({where:{workspaceId:team.id,kind:'GROUP'}});
  const send=(who:TestUser,c:string,body:string)=>call(who,'post','/conversations/'+c+'/messages',{body,clientMessageId:randomUUID()});
  await send(leader,group.id,'Team update');
  expect((await call(leader,'get','/workspaces/'+team.id+'/chat-summary')).body.data.unread).toBe(0);
  expect((await call(peer,'get','/workspaces/'+team.id+'/chat-summary')).body.data.unread).toBe(1);
  const dm=await call(leader,'post','/workspaces/'+team.id+'/conversations',{kind:'DM',peerId:peer.id});await send(leader,dm.body.data.id,'Private update');
  expect((await call(peer,'get','/workspaces/'+team.id+'/chat-summary')).body.data.unread).toBe(2);
  expect((await call(stranger,'get','/workspaces/'+team.id+'/chat-summary')).body.data.unread).toBe(1);
  expect((await call(stranger,'post','/conversations/'+dm.body.data.id+'/read',{sequence:1})).status).toBe(404);
  await call(peer,'post','/conversations/'+group.id+'/read',{sequence:1});await call(peer,'post','/conversations/'+group.id+'/read',{sequence:0});
  expect((await call(peer,'get','/workspaces/'+team.id+'/chat-summary')).body.data.unread).toBe(1);
  const membership=await db.membership.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:team.id,userId:peer.id}}});await service.changeMember(leader,team.id,peer.id,membership.version);
  expect((await call(peer,'get','/workspaces/'+team.id+'/chat-summary')).status).toBe(404);
  expect((await call(leader,'get','/workspaces/'+team.id+'/conversations')).body.items.some((c:any)=>c.id===dm.body.data.id)).toBe(false);
 });
 it('supports versioned sprint edits, atomic scope, scoped history and closed summaries',async()=>{
  const leader=await user('SprintLeader'),reader=await user('SprintReader');const team=await service.createWorkspace(leader,'Sprint test team');const link=await service.createLink(leader,team.id,{days:1,maxUses:1,requiresApproval:false});await service.acceptLink(reader,link.url.split('#token=')[1]);
  const m=await db.membership.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:team.id,userId:reader.id}}});await service.changeMember(leader,team.id,reader.id,m.version,'VIEWER');
  const project=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Sprint fixture'})).body.data.project;
  const form={name:'First delivery',goal:'Ship the prototype',startAt:new Date().toISOString(),endAt:new Date(Date.now()+86400000).toISOString()};
  const sprint=(await call(leader,'post','/projects/'+project.id+'/sprints',form)).body.data;
  expect((await call(leader,'post','/sprints/'+sprint.id+'/start',{expectedVersion:1})).status).toBe(422);
  expect((await call(reader,'patch','/sprints/'+sprint.id,{...form,expectedVersion:1})).status).toBe(403);
  expect((await call(leader,'patch','/sprints/'+sprint.id,{...form,goal:'A focused goal',expectedVersion:1})).status).toBe(200);
  expect((await call(leader,'patch','/sprints/'+sprint.id,{...form,expectedVersion:1})).status).toBe(409);
  const task=(await call(leader,'post','/projects/'+project.id+'/tasks',{title:'Core prototype'})).body.data;
  const another=(await call(leader,'post','/projects/'+project.id+'/tasks',{title:'Follow-up work'})).body.data;
  const scope={expectedVersion:2,action:'ADD',tasks:[{id:task.id,expectedVersion:1}]};
  expect((await call(reader,'post','/sprints/'+sprint.id+'/scope',scope)).status).toBe(403);
  expect((await call(leader,'post','/sprints/'+sprint.id+'/scope',{...scope,tasks:[...scope.tasks,{id:'foreign-task',expectedVersion:1}]})).status).toBe(404);
  expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).sprintId).toBeNull();
  expect((await call(leader,'post','/sprints/'+sprint.id+'/scope',scope)).status).toBe(200);
  expect((await call(leader,'post','/sprints/'+sprint.id+'/start',{expectedVersion:3})).status).toBe(200);
  await call(leader,'patch','/tasks/'+task.id,{status:'DONE',expectedVersion:2});
  const dashboard=await call(reader,'get','/sprints/'+sprint.id+'/dashboard');expect(dashboard.status).toBe(200);expect(dashboard.body.data.committed).toBe(1);expect(dashboard.body.data.burndown.at(-1).remaining).toBe(0);
  expect((await call(leader,'post','/sprints/'+sprint.id+'/scope',{expectedVersion:4,action:'ADD',tasks:[{id:another.id,expectedVersion:1}]})).status).toBe(200);
  expect((await call(leader,'post','/sprints/'+sprint.id+'/complete',{expectedVersion:5,unfinishedDestination:'KEEP'})).status).toBe(200);
  expect((await call(leader,'patch','/sprints/'+sprint.id,{...form,expectedVersion:6})).status).toBe(409);
  expect((await call(leader,'post','/sprints/'+sprint.id+'/scope',{expectedVersion:6,action:'REMOVE',tasks:[{id:another.id,expectedVersion:2}]})).status).toBe(409);
  const closed=(await call(leader,'get','/sprints/'+sprint.id+'/dashboard')).body.data;expect(closed.sprint.summary).toMatchObject({total:2,done:1,unfinished:1,decision:'KEEP'});expect(closed.committed).toBe(1);
  const other=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Other project'})).body.data.project;
  expect((await call(leader,'get','/projects/'+other.id+'/sprints?selected='+sprint.id)).status).toBe(404);
  expect((await call(reader,'get','/workspaces/'+team.id+'/sprint-dashboard')).body.items.some((s:any)=>s.id===sprint.id)).toBe(true);
  const older=await db.sprint.create({data:{projectId:project.id,name:'Older active sprint',startAt:new Date(),endAt:new Date(Date.now()+86400000),status:'ACTIVE'}});
  await db.sprint.createMany({data:Array.from({length:51},(_,i)=>({projectId:project.id,name:'Future sprint '+i,startAt:new Date(),endAt:new Date(Date.now()+86400000)}))});
  const paged=await call(leader,'get','/projects/'+project.id+'/sprints?selected='+sprint.id);expect(paged.body.active.id).toBe(older.id);expect(paged.body.selected.id).toBe(sprint.id);expect(paged.body.nextCursor).toBeTruthy();

 });

 it('isolates GitHub contributions, publishes complete syncs, handles rate limits and blocks stale jobs after disconnect or revocation',async()=>{
  const leader=await user('RepositoryLeader'),reader=await user('RepositoryReader'),stranger=await user('RepositoryStranger');
  const team=await service.createWorkspace(leader,'Repository team');
  await db.membership.create({data:{workspaceId:team.id,userId:reader.id,role:'VIEWER'}});
  const project=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Repository event'})).body.data.project;
  const path='/projects/'+project.id+'/repository';
  const envNames=['GITHUB_APP_ID','GITHUB_PRIVATE_KEY','GITHUB_WEBHOOK_SECRET','GITHUB_WORKSPACE_INSTALLATIONS_JSON'];
  const previous=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  Object.assign(process.env,{GITHUB_APP_ID:'123',GITHUB_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString(),GITHUB_WEBHOOK_SECRET:'test-webhook-secret',GITHUB_WORKSPACE_INSTALLATIONS_JSON:JSON.stringify({[team.id]:[42]})});
  const {syncRepository,gh}=await import('../apps/api/src/github');
  let mode='success',repoId=11;
  const commit={sha:'abcdef123456',commit:{message:'Implement project feature',author:{name:'Developer',date:'2026-10-20T10:00:00Z'}},author:{login:'developer'},html_url:'https://github.com/team/project/commit/abcdef123456'};
  vi.stubGlobal('fetch',async(input:string)=>{
   const url=String(input);
   if(mode==='secondary')return Response.json({message:'You have exceeded a secondary rate limit.'},{status:403});
   if(mode==='empty')return Response.json({message:'Git Repository is empty.'},{status:409});
   if(mode==='rate')return new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','retry-after':'120'}});
   if(url.includes('/access_tokens'))return Response.json({token:'fixture-token'});
   if(url.includes('/installation/repositories'))return Response.json({repositories:[{id:repoId}]});
   if(url.includes('/commits')){
    if(mode==='disconnect'){await call(leader,'delete',path);mode='success';}
    if(mode==='revoke'){await db.repositoryConnection.updateMany({where:{projectId:project.id},data:{state:'REVOKED'}});mode='success';}
    return Response.json([commit]);
   }
   if(url.includes('/pulls')){if(mode==='failure')return new Response('{}',{status:500});return Response.json([{number:1,title:'Project implementation',user:{login:'developer'},state:'closed',merged_at:'2026-10-21T00:00:00Z',html_url:'https://github.com/team/project/pull/1',updated_at:'2026-10-21T00:00:00Z'}]);}
   return Response.json({id:repoId,full_name:'team/project',html_url:'https://github.com/team/project',default_branch:'main',permissions:{pull:true}});
  });
  try{
   expect((await call(reader,'post',path,{installationId:42,fullName:'team/project'})).status).toBe(403);
   expect((await call(stranger,'get',path)).status).toBe(404);
   expect((await call(leader,'post',path,{installationId:99,fullName:'team/project'})).status).toBe(403);
   let response=await call(leader,'post',path,{installationId:42,fullName:'team/project'});expect(response.status).toBe(202);let id=response.body.data.id;
   mode='failure';await syncRepository(id,true);expect(await db.gitCommit.count({where:{connectionId:id}})).toBe(0);expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).state).toBe('FAILED');
   mode='success';await call(leader,'post',path+'/sync');await syncRepository(id);await call(leader,'post',path+'/sync');await syncRepository(id);
   response=await call(reader,'get',path+'?status=MERGED');expect(response.body.data.summary).toMatchObject({commits:1,pulls:1,contributors:[{author:'developer',commits:1,pulls:1}]});expect(response.body.data.connection.pulls[0].state).toBe('MERGED');
   expect((await call(reader,'get',path+'?status=OPEN')).body.data.connection.pulls).toHaveLength(0);
   expect((await call(reader,'get',path+'?page=21')).status).toBe(422);
   mode='empty';await expect(gh('/repos/team/project/commits?per_page=100','fixture')).resolves.toEqual([]);
   mode='secondary';await expect(gh('/test','fixture')).rejects.toThrow('RATE_LIMITED_');
   mode='rate';await expect(gh('/test','fixture')).rejects.toThrow('RATE_LIMITED_');await call(leader,'post',path+'/sync');await syncRepository(id);
   expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).state).toBe('RATE_LIMITED');expect((await call(leader,'post',path+'/sync')).status).toBe(429);
   mode='success';await db.repositoryConnection.update({where:{id},data:{state:'QUEUED',errorCode:null}});mode='disconnect';await syncRepository(id);expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).state).toBe('DISCONNECTED');
   expect((await call(leader,'post',path+'/sync')).status).toBe(409);
   repoId=22;response=await call(leader,'post',path,{installationId:42,fullName:'team/project'});expect(response.status).toBe(202);expect(response.body.data.id).not.toBe(id);id=response.body.data.id;
   expect(await db.gitCommit.count({where:{connectionId:id}})).toBe(0);
   mode='revoke';await syncRepository(id);expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).state).toBe('REVOKED');expect(await db.gitCommit.count({where:{connectionId:id}})).toBe(0);
   const payload={action:'removed',installation:{id:42},repositories_removed:[{id:22}]},raw=JSON.stringify(payload),delivery=randomUUID();
   const webhook=()=>request(app).post('/api/webhooks/github').set('Content-Type','application/json').set('x-github-event','installation_repositories').set('x-github-delivery',delivery).set('x-hub-signature-256','sha256='+createHmac('sha256',process.env.GITHUB_WEBHOOK_SECRET!).update(raw).digest('hex')).send(raw);
   expect((await request(app).post('/api/webhooks/github').set('Content-Type','application/json').send(raw)).status).toBe(401);
   expect((await webhook()).status).toBe(202);expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).errorCode).toBe('REPOSITORY_REMOVED');
   await db.repositoryConnection.update({where:{id},data:{state:'DISCONNECTED',errorCode:null}});expect((await webhook()).status).toBe(202);expect((await db.repositoryConnection.findUniqueOrThrow({where:{id}})).state).toBe('DISCONNECTED');expect(await db.githubDelivery.count({where:{id:delivery}})).toBe(1);
  }finally{vi.unstubAllGlobals();for(const k of envNames){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
 });

 it('traces explicit task PR links with scoped requirements, review evidence and opt-in all-merged completion',async()=>{
  const lead=await user('TraceLead'),peer=await user('TracePeer'),read=await user('TraceRead'),stranger=await user('TraceStranger');
  const team=await service.createWorkspace(lead,'Trace team');await db.membership.createMany({data:[{workspaceId:team.id,userId:peer.id,role:'MEMBER'},{workspaceId:team.id,userId:read.id,role:'VIEWER'}]});
  const project=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Trace challenge'})).body.data.project;
  const other=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Other trace challenge'})).body.data.project;
  const task=(await call(lead,'post','/projects/'+project.id+'/tasks',{title:'Deliver accessible sign in'})).body.data;
  const path='/tasks/'+task.id,repo='/projects/'+project.id+'/repository';
  const wiki=(await call(lead,'post','/projects/'+project.id+'/wiki',{title:'Login requirement',content:'Keyboard access required.'})).body.data;
  const wrongWiki=(await call(lead,'post','/projects/'+other.id+'/wiki',{title:'Other requirement',content:'Private to other project.'})).body.data;
  const connection=await db.repositoryConnection.create({data:{projectId:project.id,installationId:0,repositoryId:991,fullName:'team/trace',url:'https://github.com/team/trace',state:'READY'}});
  const pulls=await Promise.all([1,2].map(number=>db.gitPullRequest.create({data:{connectionId:connection.id,number,title:'Implement '+number,author:'dev',state:'OPEN',url:'https://github.com/team/trace/pull/'+number,updatedAt:new Date()}})));
  expect((await call(stranger,'get',path+'/traceability')).status).toBe(404);
  expect((await call(read,'post',path+'/pulls',{url:pulls[0].url})).status).toBe(403);
  expect((await call(peer,'patch',path+'/traceability',{expectedVersion:1,autoCompleteOnMerge:true})).status).toBe(403);
  expect((await call(peer,'patch',path+'/traceability',{expectedVersion:1,requirementWikiId:wrongWiki.id})).status).toBe(422);
  expect((await call(peer,'patch',path+'/traceability',{expectedVersion:1,requirement:'Keyboard access works',requirementWikiId:wiki.id})).status).toBe(200);
  expect((await call(peer,'patch',path+'/traceability',{expectedVersion:1,requirement:'Stale'})).status).toBe(409);
  for(const url of ['https://github.com/other/repo/pull/1','https://github.com/team/trace/issues/1','https://evil.test/team/trace/pull/1','https://github.com/team/trace/pull/1?x=1','https://github.com/team/trace/pull/99','https://github.com/team/trace/pull/999999999999999999999'])expect((await call(peer,'post',path+'/pulls',{url})).status).toBe(422);
  const link=(await call(peer,'post',path+'/pulls',{url:pulls[0].url})).body.data;
  await call(peer,'post',path+'/pulls',{url:pulls[0].url});await call(peer,'post',path+'/pulls',{url:pulls[1].url});expect(await db.taskPullLink.count({where:{taskId:task.id}})).toBe(2);
  const otherTask=(await call(lead,'post','/projects/'+other.id+'/tasks',{title:'Unrelated task'})).body.data;
  expect((await call(lead,'delete','/tasks/'+otherTask.id+'/pulls/'+link.id)).status).toBe(404);
  let merged=false,fail=false;
  vi.stubGlobal('fetch',async(input:string)=>{const url=String(input);
   if(url.includes('/reviews?'))return fail?new Response('{}',{status:500}):Response.json([{id:1,user:{login:'reviewer'},state:'APPROVED',submitted_at:'2026-10-20T10:00:00Z'}]);
   if(url.includes('/commits?'))return Response.json([]);
   if(url.includes('/pulls?'))return Response.json([1,2].map(number=>({number,title:'Implement '+number,user:{login:'dev'},state:merged||number===1?'closed':'open',merged_at:merged||number===1?'2026-10-21T00:00:00Z':null,html_url:'https://github.com/team/trace/pull/'+number,updated_at:new Date().toISOString()})));
   return Response.json({private:false});});
  const {syncRepository}=await import('../apps/api/src/github');
  const sync=async()=>{await db.repositoryConnection.update({where:{id:connection.id},data:{state:'QUEUED'}});await syncRepository(connection.id,true);};
  try{
   await sync();expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('TODO');
   let data=(await call(read,'get',path+'/traceability')).body.data;expect(data.links[0].reviewState).toBe('APPROVED');expect(data.wiki.id).toBe(wiki.id);expect(data.history.some((h:any)=>h.changes.reason==='traceability.synced')).toBe(true);
   expect((await call(lead,'patch',path+'/traceability',{expectedVersion:data.task.version,autoCompleteOnMerge:true})).status).toBe(200);
   await sync();expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('TODO');
   merged=true;fail=true;await sync();expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('TODO');expect((await db.gitPullRequest.findUniqueOrThrow({where:{id:pulls[1].id}})).state).toBe('OPEN');
   fail=false;await sync();expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('DONE');await sync();expect(await db.taskHistory.count({where:{taskId:task.id,actorId:'github-sync',changes:{path:['reason'],equals:'traceability.auto-completed'}}})).toBe(1);
   const done=await db.task.findUniqueOrThrow({where:{id:task.id}});await call(peer,'patch',path,{expectedVersion:done.version,status:'TODO'});
   const sprint=await db.sprint.create({data:{projectId:project.id,name:'Frozen sprint',goal:'Preserve record',startAt:new Date(),endAt:new Date(Date.now()+3600000),status:'COMPLETED'}});await db.task.update({where:{id:task.id},data:{sprintId:sprint.id}});await sync();expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('TODO');
   await call(lead,'delete',repo);expect((await call(peer,'post',path+'/pulls',{url:pulls[0].url})).status).toBe(409);
   await db.gitPullRequest.deleteMany({where:{connectionId:connection.id}});data=(await call(read,'get',path+'/traceability')).body.data;expect(data.links).toHaveLength(2);expect(data.links.every((l:any)=>l.pull===null)).toBe(true);
   expect((await call(peer,'delete',path+'/pulls/'+link.id)).status).toBe(200);expect((await call(read,'get',path+'/traceability')).body.data.links).toHaveLength(1);
  }finally{vi.unstubAllGlobals();}
 });

 it('connects public repositories without keys or a worker and rejects private access in public mode',async()=>{
  const leader=await user('PublicRepoLeader'),team=await service.createWorkspace(leader,'Public repository team');
  const project=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Public project'})).body.data.project,path='/projects/'+project.id+'/repository';
  let privateRepo=false;
  vi.stubGlobal('fetch',async(input:string,init:RequestInit)=>{
   expect((init.headers as Record<string,string>).Authorization).toBeUndefined();
   const url=String(input);if(url.includes('/commits?'))return Response.json([]);if(url.includes('/pulls?'))return Response.json([]);
   return Response.json({id:123,full_name:'public/example',html_url:'https://github.com/public/example',default_branch:'main',private:privateRepo});
  });
  try{
   expect((await call(leader,'get',path)).body.data.publicAvailable).toBe(true);
   privateRepo=true;expect((await call(leader,'post',path,{fullName:'public/example'})).status).toBe(403);
   privateRepo=false;const response=await call(leader,'post',path,{fullName:'public/example'});expect(response.status).toBe(202);expect(response.body.data).toMatchObject({installationId:0,state:'READY'});
   expect((await call(leader,'post',path+'/sync')).body.data.state).toBe('READY');
   privateRepo=true;expect((await call(leader,'post',path+'/sync')).body.data.state).toBe('REVOKED');
   expect((await call(leader,'post',path,{fullName:'https://localhost/private'})).status).toBe(422);
  }finally{vi.unstubAllGlobals();}
 });
 it('answers with isolated project context and publishes an architecture once to the shared versioned wiki',async()=>{
  const leader=await user('AssistantLeader'),peer=await user('AssistantPeer'),reader=await user('AssistantReader'),stranger=await user('AssistantStranger');
  const team=await service.createWorkspace(leader,'Assistant team');
  await db.membership.createMany({data:[{workspaceId:team.id,userId:peer.id,role:'MEMBER'},{workspaceId:team.id,userId:reader.id,role:'VIEWER'}]});
  const project=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Assistant challenge'})).body.data.project,path='/projects/'+project.id+'/ai';
  await call(leader,'patch','/projects/'+project.id,{name:'Accessible prototype',description:'Build an accessible scheduling prototype.',status:'BUILDING',expectedVersion:1});
  const doc=(await call(leader,'post','/projects/'+project.id+'/documents',{title:'Project requirements',text:'The project must support keyboard navigation and accessible workflows.'})).body.data;
  const task=(await call(leader,'post','/projects/'+project.id+'/tasks',{title:'Implement keyboard navigation'})).body.data;
  await call(leader,'post','/projects/'+project.id+'/wiki',{title:'Existing team decision',content:'Use server authorization for all project data.'});
  const secretProject=(await call(stranger,'post','/workspaces',{name:'Other private team'})).body.data;
  const other=(await call(stranger,'post','/workspaces/'+secretProject.id+'/hackathons',{name:'Other private project'})).body.data.project;
  const otherDoc=(await call(stranger,'post','/projects/'+other.id+'/documents',{title:'Other team secret',text:'Do not share this confidential unrelated team requirement.'})).body.data;
  const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.LLM_MODEL;process.env.OPENAI_API_KEY='test-only-key';process.env.LLM_MODEL='test-only-model';
  let mode='ok',providerInput:any;
  const fixture={answer:'Build keyboard navigation first. Source: Project requirements, Section 1.',requirements:[{text:'Support keyboard navigation',documentId:doc.id,section:'Section 1',quote:'keyboard navigation'}],recommendations:['Validate the accessible workflow with the team.'],tasks:[],wiki:{title:'Project architecture and workflow',content:'## Proposed architecture\nClient → authenticated API → project database.\n\nAssumption: use the existing application stack.',mermaid:'flowchart LR\n  Client --> API\n  API --> Database'}};
  vi.stubGlobal('fetch',async(_input:string,init:RequestInit)=>{
   const body=JSON.parse(String(init.body));expect(body.store).toBe(false);expect(body.text.format.strict).toBe(true);providerInput=JSON.parse(body.input);
   expect(JSON.stringify(providerInput)).not.toContain('Other team secret');
   if(mode==='unauthorized')return new Response('{}',{status:401});if(mode==='rate')return new Response('{}',{status:429});
   if(mode==='revoked')await db.membership.update({where:{workspaceId_userId:{workspaceId:team.id,userId:leader.id}},data:{active:false}});
   const data=structuredClone(fixture);if(mode==='citation')data.requirements[0].quote='This quote was never supplied';if(mode==='diagram')data.wiki.mermaid='flowchart LR\n click Client "https://evil.example"';
   return Response.json({status:mode==='incomplete'?'incomplete':'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:100,output_tokens:100}});
  });
  try{
   expect((await call(reader,'post',path,{prompt:'How should this project work?',mode:'ASK'})).status).toBe(403);
   expect((await call(stranger,'post',path,{prompt:'How should this project work?',mode:'ASK'})).status).toBe(404);
   expect((await call(leader,'post',path,{prompt:'Read another team document',mode:'ASK',documentIds:[otherDoc.id]})).status).toBe(422);
   let response=await call(leader,'post',path,{prompt:'Explain our main project features and architecture.',mode:'ARCHITECTURE',documentIds:[doc.id]});expect(response.status).toBe(201);expect(response.body.data.state,JSON.stringify(response.body.data)).toBe('READY');const run=response.body.data;
   expect(providerInput.sources.some((s:any)=>s.documentId==='task:'+task.id)).toBe(true);expect(providerInput.sources.some((s:any)=>s.title==='Existing team decision')).toBe(true);
   expect(providerInput.coverage.privateMessagesIncluded).toBe(false);expect(await db.wikiPage.count({where:{projectId:project.id}})).toBe(1);
   expect((await call(peer,'get',path)).body.items).toHaveLength(0);
   const publish={tasks:[],wiki:fixture.wiki};expect((await call(peer,'post','/ai/'+run.id+'/approve',publish)).status).toBe(404);
   response=await call(leader,'post','/ai/'+run.id+'/approve',publish);expect(response.status).toBe(200);const wikiId=response.body.data.wikiId;
   const retry=await call(leader,'post','/ai/'+run.id+'/approve',publish);expect(retry.body.data.wikiId).toBe(wikiId);
   expect(await db.wikiRevision.count({where:{pageId:wikiId}})).toBe(1);expect(await db.notification.count({where:{sourceKey:'ai-wiki:'+run.id}})).toBe(2);
   expect((await call(reader,'get','/projects/'+project.id+'/wiki')).body.items.some((p:any)=>p.id===wikiId&&p.mermaid===fixture.wiki.mermaid)).toBe(true);
   expect((await call(leader,'post','/ai/'+run.id+'/approve',{tasks:[],wiki:{...fixture.wiki,mermaid:'flowchart LR\n click A "https://evil.example"'}})).status).toBe(422);
   response=await call(leader,'post',path,{prompt:'Explain the next feature in more detail.',mode:'ASK',documentIds:[doc.id]});expect(response.body.data.state).toBe('READY');expect(providerInput.previous).toHaveLength(1);
   for(const [flag,code] of [['unauthorized','PROVIDER_AUTH_FAILED'],['rate','PROVIDER_RATE_LIMIT'],['citation','INVALID_CITATION'],['diagram','UNSAFE_DIAGRAM'],['incomplete','INCOMPLETE_RESPONSE']]){
    mode=flag;response=await call(leader,'post',path,{prompt:'Explain project architecture safely.',mode:'ASK',documentIds:[doc.id]});expect(response.body.data).toMatchObject({state:'FAILED',errorCode:code});
   }
   mode='revoked';response=await call(leader,'post',path,{prompt:'Explain the architecture after permissions change.',mode:'ASK',documentIds:[doc.id]});expect(response.status).toBe(404);
   expect((await db.aiRun.findFirstOrThrow({where:{projectId:project.id},orderBy:{createdAt:'desc'}})).state).toBe('FAILED');
  }finally{vi.unstubAllGlobals();if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.LLM_MODEL;else process.env.LLM_MODEL=oldModel;}
 });

 it('selects AI context securely, persists navigable evidence and honest latency/token metrics',async()=>{
  const lead=await user('TrustLead'),read=await user('TrustRead'),stranger=await user('TrustStranger');const team=await service.createWorkspace(lead,'Trust team');await db.membership.create({data:{workspaceId:team.id,userId:read.id,role:'VIEWER'}});
  const project=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Trust project'})).body.data.project,p=project.id,path='/projects/'+p+'/ai';
  const other=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Unrelated trust project'})).body.data.project;
  const doc=(await call(lead,'post','/projects/'+p+'/documents',{title:'Accessible feature brief',text:'EXCLUDED_SECTION_SECRET '.padEnd(3000,'x')+'Selected keyboard navigation requirement for the prototype.'})).body.data;
  const chunks=await db.documentChunk.findMany({where:{documentId:doc.id},orderBy:{section:'asc'}});
  const otherDoc=(await call(lead,'post','/projects/'+other.id+'/documents',{title:'Other private brief',text:'OTHER_WORKSPACE_PRIVATE_SECRET do not include in answers.'})).body.data;
  const otherChunk=await db.documentChunk.findFirstOrThrow({where:{documentId:otherDoc.id}});
  const task=(await call(lead,'post','/projects/'+p+'/tasks',{title:'EXCLUDED_TASK_SECRET'})).body.data;
  const otherTask=(await call(lead,'post','/projects/'+other.id+'/tasks',{title:'Other project task'})).body.data;
  const wiki=(await call(lead,'post','/projects/'+p+'/wiki',{title:'EXCLUDED_WIKI_SECRET',content:'Only include if explicitly selected.'})).body.data;
  expect((await call(stranger,'get',path+'/context')).status).toBe(404);expect((await call(read,'get',path+'/context')).body.data.tasks[0].id).toBe(task.id);
  expect((await call(lead,'get','/projects/'+p+'/documents/'+otherDoc.id)).status).toBe(404);expect((await call(lead,'get','/projects/'+p+'/wiki/'+wiki.id)).status).toBe(200);expect((await call(lead,'get','/projects/'+other.id+'/wiki/'+wiki.id)).status).toBe(404);
  const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.LLM_MODEL;process.env.OPENAI_API_KEY='test-only';process.env.LLM_MODEL='fixture-model';let invalid=false,lastInput:any;
  const context={project:false,schedule:false,tasks:false,wiki:false,repository:false,history:false,sectionIds:[chunks[1].id]};
  vi.stubGlobal('fetch',async(_input:string,init:RequestInit)=>{
   const body=JSON.parse(String(init.body));expect(body.instructions).toContain('untrusted');expect(body.text.format.schema.required).toContain('citations');lastInput=JSON.parse(body.input);
   expect(JSON.stringify(lastInput)).not.toContain('OTHER_WORKSPACE_PRIVATE_SECRET');
   const source=lastInput.sources.find((r:any)=>r.chunkId===chunks[1].id);
   const result={answer:source?'Implement keyboard navigation. ['+(invalid?'S99':source.sourceId)+']':'The confirmed deadline is not available in the selected context.',citations:source?[{sourceId:invalid?'S99':source.sourceId,quote:'keyboard navigation'}]:[],requirements:[],recommendations:[],tasks:[],wiki:{title:'Unpublished design',content:'Review assumptions.',mermaid:''}};
   return Response.json({status:'completed',usage:{input_tokens:37,output_tokens:11},output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});
  });
  try{
   const count=await db.aiRun.count({where:{projectId:p}});
   for(const bad of [{taskIds:[otherTask.id]},{wikiIds:[otherDoc.id]},{sectionIds:[otherChunk.id]}])expect((await call(lead,'post',path,{prompt:'Explain the next feature safely.',mode:'ASK',documentIds:[doc.id],context:bad})).status).toBe(422);
   expect(await db.aiRun.count({where:{projectId:p}})).toBe(count);
   let response=await call(lead,'post',path,{prompt:'Explain the selected keyboard feature.',mode:'ASK',documentIds:[doc.id],context});expect(response.body.data.state,JSON.stringify(response.body)).toBe('READY');let run=response.body.data;
   expect(lastInput.sources).toHaveLength(1);expect(lastInput.previous).toHaveLength(0);expect(JSON.stringify(lastInput)).not.toContain('EXCLUDED_SECTION_SECRET');expect(JSON.stringify(lastInput)).not.toContain('EXCLUDED_TASK_SECRET');expect(JSON.stringify(lastInput)).not.toContain('EXCLUDED_WIKI_SECRET');
   expect(run.contextOptions).toMatchObject(context);expect(run.result.sourceReferences[0]).toMatchObject({documentId:doc.id,chunkId:chunks[1].id,section:'Section 2',quote:'keyboard navigation'});expect(run.result.sourceReferences[0]).not.toHaveProperty('text');expect(run.metrics).toMatchObject({citationTotal:1,citationsValid:1,citationValidity:1});expect(run.metrics.latencyMs).toBeGreaterThanOrEqual(0);expect(run.metrics.providerLatencyMs).toBeGreaterThanOrEqual(0);expect(run.inputTokens).toBe(37);expect(run.outputTokens).toBe(11);
   const reader=(await call(lead,'get','/projects/'+p+'/documents/'+doc.id)).body.data;expect(reader.chunks.some((c:any)=>c.id===run.result.sourceReferences[0].chunkId)).toBe(true);
   response=await call(lead,'post',path,{prompt:'What is the confirmed submission deadline?',mode:'ASK',context:{...context,sectionIds:[]}});expect(response.body.data.state).toBe('READY');expect(response.body.data.metrics.citationValidity).toBeNull();expect(lastInput.sources).toHaveLength(0);expect(lastInput.previous).toHaveLength(0);
   invalid=true;response=await call(lead,'post',path,{prompt:'Explain the feature using a source.',mode:'ASK',documentIds:[doc.id],context});expect(response.body.data).toMatchObject({state:'FAILED',errorCode:'INVALID_CITATION',inputTokens:37,outputTokens:11});expect(response.body.data.metrics).toMatchObject({citationTotal:1,citationsValid:0,citationValidity:0,markersValid:false});
   expect(await db.wikiPage.count({where:{projectId:p}})).toBe(1);expect((await call(read,'get',path)).body.items).toHaveLength(0);
  }finally{vi.unstubAllGlobals();if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.LLM_MODEL;else process.env.LLM_MODEL=oldModel;}
 });

 it('claims assistant generation once, blocks concurrent requests, recovers stale requests and enforces the workspace budget',async()=>{
  const leader=await user('AssistantBudgetLeader'),team=await service.createWorkspace(leader,'Assistant budget team');
  const project=(await call(leader,'post','/workspaces/'+team.id+'/hackathons',{name:'Assistant budget project'})).body.data.project,path='/projects/'+project.id+'/ai';
  const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.LLM_MODEL;process.env.OPENAI_API_KEY='test-only';process.env.LLM_MODEL='test-model';
  const {generateReview}=await import('../apps/api/src/ai-service');let release!:()=>void,started!:()=>void,calls=0;
  const startedPromise=new Promise<void>(r=>started=r),wait=new Promise<void>(r=>release=r);
  vi.stubGlobal('fetch',async()=>{calls++;started();await wait;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'An isolated project answer.',requirements:[],recommendations:[],tasks:[],wiki:{title:'Project draft',content:'Review with your team.',mermaid:''}})}]}]});});
  try{
   const run=await db.aiRun.create({data:{projectId:project.id,userId:leader.id,prompt:'[ASK] Explain the next project step.',documentIds:[],model:'test-model'}});
   const pending=generateReview(run.id);await startedPromise;await generateReview(run.id);
   expect((await call(leader,'post',path,{prompt:'A concurrent question should wait.',mode:'ASK'})).status).toBe(409);
   release();await pending;expect(calls).toBe(1);expect((await db.aiRun.findUniqueOrThrow({where:{id:run.id}})).state).toBe('READY');
   const stale=await db.aiRun.create({data:{projectId:project.id,userId:leader.id,prompt:'Interrupted request',documentIds:[],model:'test-model',state:'RUNNING',updatedAt:new Date(Date.now()-240000)}});
   await call(leader,'get',path);expect((await db.aiRun.findUniqueOrThrow({where:{id:stale.id}})).errorCode).toBe('REQUEST_INTERRUPTED');
   await db.aiRun.createMany({data:Array.from({length:18},()=>({projectId:project.id,userId:leader.id,prompt:'Budget fixture',documentIds:[],model:'test-model',state:'FAILED'}))});
   expect((await call(leader,'post',path,{prompt:'A request above the workspace daily budget.',mode:'ASK'})).status).toBe(429);
  }finally{release();vi.unstubAllGlobals();if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.LLM_MODEL;else process.env.LLM_MODEL=oldModel;}
 });

 it('keeps submission readiness isolated, assigns evidence owners and exports without submitting the project',async()=>{
  const lead=await user('SubmissionLead'),peer=await user('SubmissionPeer'),reader=await user('SubmissionViewer'),stranger=await user('SubmissionStranger');
  const team=await service.createWorkspace(lead,'Submission team');await db.membership.createMany({data:[{workspaceId:team.id,userId:peer.id,role:'MEMBER'},{workspaceId:team.id,userId:reader.id,role:'VIEWER'}]});
  const project=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Submission challenge',officialUrl:'https://example.test/hackathon'})).body.data.project,p=project.id,path='/projects/'+p+'/readiness';
  const other=(await call(lead,'post','/workspaces/'+team.id+'/hackathons',{name:'Other submission'})).body.data.project;
  const foreignWiki=(await call(lead,'post','/projects/'+other.id+'/wiki',{title:'Other project architecture',content:'Other project only'})).body.data;
  const wiki=(await call(lead,'post','/projects/'+p+'/wiki',{title:'Project architecture',content:'Our architecture and workflow.'})).body.data;
  expect((await call(stranger,'get',path)).status).toBe(404);expect((await call(reader,'post',path+'/starter')).status).toBe(403);expect((await call(peer,'post',path+'/items',{title:'Unauthorized item'})).status).toBe(403);
  expect((await call(lead,'get',path)).body.data.blockers).toContain('Confirm the official submission deadline');
  await Promise.all([call(lead,'post',path+'/starter'),call(lead,'post',path+'/starter')]);expect(await db.submissionItem.count({where:{projectId:p}})).toBe(5);
  expect((await call(lead,'patch','/projects/'+p+'/details',{name:project.name,description:'Submission test',status:'BUILDING',repositoryUrl:'https://github.com/team/project',demoUrl:'https://example.test/demo',expectedVersion:1})).status).toBe(200);
  const deadline=await request(app).put('/api/v1/projects/'+p+'/deadline').set('Origin',origin).set('Cookie',lead.cookie).send({instant:'2030-06-01T12:00:00Z',timezone:'Asia/Kolkata',sourceUrl:'https://example.test/rules',sourceExcerpt:'Submit by the confirmed deadline.',expectedVersion:0});expect(deadline.status).toBe(200);
  let rows=(await call(lead,'get',path)).body.data.items;
  for(const item of rows){
   expect((await call(lead,'patch',path+'/items/'+item.id,{ownerId:stranger.id,expectedVersion:1})).status).toBe(422);
   expect((await call(lead,'patch',path+'/items/'+item.id,{ownerId:reader.id,expectedVersion:1})).status).toBe(422);
   if(item.kind==='ARCHITECTURE')expect((await call(lead,'patch',path+'/items/'+item.id,{wikiPageId:foreignWiki.id,expectedVersion:1})).status).toBe(422);
   expect((await call(lead,'patch',path+'/items/'+item.id,{ownerId:peer.id,notes:'Preserve evidence notes',...(item.kind==='ARCHITECTURE'?{wikiPageId:wiki.id}:item.kind==='PITCH'?{url:'https://example.test/pitch'}:{}),expectedVersion:1})).status).toBe(200);
   expect((await call(reader,'patch',path+'/items/'+item.id,{done:true,expectedVersion:2})).status).toBe(403);
   expect((await call(peer,'patch',path+'/items/'+item.id,{required:false,expectedVersion:2})).status).toBe(403);
   expect((await call(peer,'patch',path+'/items/'+item.id,{done:true,expectedVersion:2})).status).toBe(200);
   expect((await call(peer,'patch',path+'/items/'+item.id,{done:false,expectedVersion:2})).status).toBe(409);
  }
  const optional=await call(lead,'post',path+'/items',{title:'Optional video walkthrough',required:false});expect(optional.status).toBe(201);
  let snapshot=(await call(reader,'get',path)).body.data;expect(snapshot).toMatchObject({ready:true,requiredReady:5,requiredTotal:5,deadlinePassed:false});expect(snapshot.items.every((i:any)=>!i.required||i.notes==='Preserve evidence notes')).toBe(true);expect(snapshot.items.find((i:any)=>i.kind==='REPOSITORY').evidenceUrl).toBe('https://github.com/team/project');
  const md=await call(reader,'get',path+'/export');expect(md.status).toBe(200);expect(md.body.data.content).toContain('https://example.test/pitch');expect(md.body.data.content).toContain('?tab=wiki&page='+wiki.id);expect(md.body.data.content).toContain('2030-06-01T12:00:00.000Z');
  const json=await call(reader,'get',path+'/export?format=json');expect(JSON.parse(json.body.data.content).ready).toBe(true);expect((await db.hackathon.findUniqueOrThrow({where:{id:project.hackathonId}})).status).toBe('ACTIVE');
  expect((await call(stranger,'get',path+'/export')).status).toBe(404);
  expect((await call(lead,'post',path+'/items',{title:'Unsafe link',url:'javascript:alert(1)'})).status).toBe(422);
  const item=rows[0];expect((await call(lead,'patch','/projects/'+other.id+'/readiness/items/'+item.id,{done:true,expectedVersion:3})).status).toBe(404);
  const changes=await Promise.all([call(lead,'patch',path+'/items/'+item.id,{notes:'First edit',expectedVersion:3}),call(lead,'patch',path+'/items/'+item.id,{notes:'Second edit',expectedVersion:3})]);expect(changes.map(r=>r.status).sort()).toEqual([200,409]);
  await db.membership.update({where:{workspaceId_userId:{workspaceId:team.id,userId:peer.id}},data:{active:false}});snapshot=(await call(lead,'get',path)).body.data;expect(snapshot.ready).toBe(false);expect(snapshot.items.find((i:any)=>i.id===item.id).missing).toContain('Assign an active owner');
  await db.deadline.update({where:{projectId:p},data:{instant:new Date('2020-01-01T00:00:00Z')}});expect((await call(lead,'get',path)).body.data.deadlinePassed).toBe(true);
  expect((await call(lead,'delete',path+'/items/'+optional.body.data.id,{expectedVersion:2})).status).toBe(409);expect((await call(lead,'delete',path+'/items/'+optional.body.data.id,{expectedVersion:1})).status).toBe(200);
  expect(await db.wikiPage.count({where:{id:wiki.id}})).toBe(1);
 });

});
