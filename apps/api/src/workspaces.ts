import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../../packages/db';
import type { Prisma } from '../../../packages/db/generated/client';
import { mayManage, mayChange, type Role } from '../../../packages/contracts';
import { requireThat } from './errors';
import { capabilities, config } from './config';
import { encrypt } from './email';
type Tx = Prisma.TransactionClient;
export type Actor = { id: string; email: string; name: string };
export const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('hex');
const week = () => new Date(Date.now()+7*86400000);
export async function membership(tx: Tx, w: string, userId: string, manage = false) {
  const m = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: w, userId } } });
  requireThat(m?.active, 404, 'NOT_FOUND', 'Workspace not found.');
  requireThat(!manage || mayManage(m.role), 403, 'FORBIDDEN', 'You cannot manage this workspace.');
  return m;
}
async function lock(tx: Tx, w: string) { await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${w} FOR UPDATE`; }
async function record(tx: Tx, w: string, actor: string, action: string, targetId: string) {
  await tx.auditEvent.create({ data: { workspaceId: w, actorId: actor, action, targetId } });
  await tx.outboxEvent.create({ data: { type: action, entityId: targetId } });
}
async function grant(tx: Tx, w: string, userId: string, role: Role) {
  const existing = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: w, userId } } });
  if (existing?.active) return existing;
  return tx.membership.upsert({
    where: { workspaceId_userId: { workspaceId: w, userId } },
    create: { workspaceId: w, userId, role },
    update: { active: true, role, version: { increment: 1 } },
  });
}
export async function createWorkspace(actor: Actor, name: string) {
  return db.$transaction(async tx => {
    const workspace = await tx.workspace.create({ data: { name, memberships: { create: { userId: actor.id, role: 'OWNER' } } } });
    await tx.conversation.create({data:{workspaceId:workspace.id,kind:'GROUP',name:'Team conversation',scopeKey:'workspace:'+workspace.id}});
    await record(tx, workspace.id, actor.id, 'workspace.created', workspace.id);
    return workspace;
  });
}
export async function changeMember(actor: Actor, w: string, target: string, version: number, role?: Exclude<Role,'OWNER'>) {
  return db.$transaction(async tx => {
    await lock(tx,w);
    const caller = await membership(tx,w,actor.id,true);
    const member = await membership(tx,w,target);
    requireThat(mayChange(caller.role,member.role,role),403,'FORBIDDEN','This role change is not permitted. Use ownership transfer for owners.');
    requireThat(member.version === version,409,'CONFLICT','Membership changed. Refresh before trying again.');
    const result = await tx.membership.update({ where: { id: member.id }, data: { ...(role ? {role} : {active:false}), version: {increment:1} } });
    await record(tx,w,actor.id,role ? 'membership.changed':'membership.removed',target);
    return result;
  });
}
export async function transfer(actor: Actor, w: string, target: string, version: number) {
  return db.$transaction(async tx => {
    await lock(tx,w);
    const caller = await membership(tx,w,actor.id);
    requireThat(caller.role === 'OWNER' && target !== actor.id,403,'FORBIDDEN','Choose another active member to transfer ownership.');
    const workspace = await tx.workspace.findUniqueOrThrow({where:{id:w}});
    requireThat(workspace.version === version,409,'CONFLICT','Workspace changed. Refresh and try again.');
    const recipient = await membership(tx,w,target);
    const user = await tx.user.findUniqueOrThrow({where:{id:target}});
    requireThat(user.emailVerified,422,'UNVERIFIED','The new owner must verify their email.');
    await tx.membership.update({where:{id:recipient.id},data:{role:'OWNER',version:{increment:1}}});
    await tx.membership.update({where:{id:caller.id},data:{role:'ADMIN',version:{increment:1}}});
    await tx.workspace.update({where:{id:w},data:{version:{increment:1}}});
    await record(tx,w,actor.id,'ownership.transferred',target);
    return { transferred: true };
  });
}
async function inviteMail(tx: Tx, invite: {id:string; email:string; role:Role; expiresAt:Date}, name:string, inviter:string, raw:string) {
  const url = config.APP_ORIGIN+'/invite#token='+raw;
  const delivery = await tx.emailDelivery.create({ data: {
    invitationId: invite.id, expiresAt: invite.expiresAt,
    encryptedPayload: encrypt({to:invite.email,subject:'Invitation to '+name,text:inviter+' invited you to '+name+' as '+invite.role+'. Expires '+invite.expiresAt.toISOString()+'. Sign in with this verified email to accept: '+url}),
  } });
  await tx.outboxEvent.create({data:{type:'email.queued',entityId:delivery.id}});
}
export async function invite(actor: Actor, w:string, emails:string[], role:Exclude<Role,'OWNER'>) {
  requireThat(capabilities.email,503,'EMAIL_UNAVAILABLE','Configure an email provider before sending invitations.');
  return db.$transaction(async tx => {
    await lock(tx,w);
    const caller = await membership(tx,w,actor.id,true);
    requireThat(caller.role === 'OWNER' || role !== 'ADMIN',403,'FORBIDDEN','Only owners may invite admins.');
    const workspace = await tx.workspace.findUniqueOrThrow({where:{id:w}});
    const result = [];
    for (const email of new Set(emails.map(value=>value.trim().toLowerCase()))) {
      const existingMember=await tx.membership.findFirst({where:{workspaceId:w,active:true,user:{email:{equals:email,mode:'insensitive'}}}});
      requireThat(!existingMember,409,'ALREADY_MEMBER','This email already belongs to a workspace member.');
      const pending=await tx.invitation.findFirst({where:{workspaceId:w,email:{equals:email,mode:'insensitive'},acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}});
      requireThat(!pending,409,'INVITATION_PENDING','An active invitation already exists for this email. Use Resend on the existing invitation.');
      const raw = token();
      const i = await tx.invitation.create({data:{workspaceId:w,email,role,tokenHash:hash(raw),expiresAt:week(),inviterId:actor.id}});
      await inviteMail(tx,i,workspace.name,actor.name,raw);
      await record(tx,w,actor.id,'invitation.created',i.id);
      result.push({id:i.id,email:i.email,state:'PENDING',delivery:'QUEUED'});
    }
    return result;
  });
}
export async function updateInvite(actor:Actor,w:string,id:string,resend:boolean) {
  requireThat(!resend || capabilities.email,503,'EMAIL_UNAVAILABLE','Email delivery is unavailable.');
  return db.$transaction(async tx => {
    await lock(tx,w);
    const caller = await membership(tx,w,actor.id,true);
    const i = await tx.invitation.findFirst({where:{id,workspaceId:w}});
    requireThat(i,404,'NOT_FOUND','Invitation not found.');
    requireThat(caller.role === 'OWNER' || i.role !== 'ADMIN',403,'FORBIDDEN','Only owners may manage admin invitations.');
    requireThat(!i.acceptedAt && !i.revokedAt,409,'CLOSED','This invitation is already closed.');
    requireThat(!resend || Date.now()-i.lastSentAt.getTime() >= 60000,429,'COOLDOWN','Wait one minute before resending.');
    await tx.emailDelivery.updateMany({where:{invitationId:id,state:'QUEUED'},data:{state:'CANCELLED',encryptedPayload:null}});
    if (resend) {
      const raw=token();
      const updated=await tx.invitation.update({where:{id},data:{tokenHash:hash(raw),expiresAt:week(),lastSentAt:new Date(),version:{increment:1}}});
      const workspace=await tx.workspace.findUniqueOrThrow({where:{id:w}});
      await inviteMail(tx,updated,workspace.name,actor.name,raw);
    } else await tx.invitation.update({where:{id},data:{revokedAt:new Date(),version:{increment:1}}});
    await record(tx,w,actor.id,resend?'invitation.resent':'invitation.revoked',id);
    return {state:resend?'QUEUED':'REVOKED'};
  });
}
export async function acceptInvite(actor:Actor,raw:string) {
  return db.$transaction(async tx => {
    let i=await tx.invitation.findUnique({where:{tokenHash:hash(raw)}});
    requireThat(i,404,'INVALID_INVITE','Invitation not found.');
    await lock(tx,i.workspaceId);
    i=await tx.invitation.findUniqueOrThrow({where:{id:i.id}});
    requireThat(i.email === actor.email.toLowerCase(),403,'EMAIL_MISMATCH','Sign in with the email address that received this invitation.');
    if(i.acceptedAt) {
      requireThat(i.acceptedBy === actor.id,409,'USED','Invitation already used.');
      await membership(tx,i.workspaceId,actor.id);
      return {workspaceId:i.workspaceId};
    }
    requireThat(!i.revokedAt && i.expiresAt.getTime()>Date.now(),410,'EXPIRED','Invitation expired or was revoked.');
    await grant(tx,i.workspaceId,actor.id,i.role);
    await tx.invitation.update({where:{id:i.id},data:{acceptedAt:new Date(),acceptedBy:actor.id,version:{increment:1}}});
    await record(tx,i.workspaceId,actor.id,'invitation.accepted',i.id);
    return {workspaceId:i.workspaceId};
  });
}
export async function createLink(actor:Actor,w:string,input:{days:number;maxUses:number;requiresApproval:boolean}) {
  return db.$transaction(async tx => {
    await lock(tx,w); await membership(tx,w,actor.id,true);
    const raw=token();
    const link=await tx.joinLink.create({data:{workspaceId:w,tokenHash:hash(raw),expiresAt:new Date(Date.now()+input.days*86400000),maxUses:input.maxUses,requiresApproval:input.requiresApproval}});
    await record(tx,w,actor.id,'joinLink.created',link.id);
    return {id:link.id,url:config.APP_ORIGIN+'/join#token='+raw,expiresAt:link.expiresAt};
  });
}
export async function revokeLink(actor:Actor,w:string,id:string) {
  return db.$transaction(async tx => {
    await lock(tx,w);await membership(tx,w,actor.id,true);
    const result=await tx.joinLink.updateMany({where:{id,workspaceId:w},data:{revokedAt:new Date()}});
    requireThat(result.count,404,'NOT_FOUND','Link not found.');
    await record(tx,w,actor.id,'joinLink.revoked',id);return {revoked:true};
  });
}
export async function acceptLink(actor:Actor,raw:string) {
  return db.$transaction(async tx => {
    let link=await tx.joinLink.findUnique({where:{tokenHash:hash(raw)}});
    requireThat(link,404,'INVALID_LINK','Join link not found.');
    await lock(tx,link.workspaceId);
    link=await tx.joinLink.findUniqueOrThrow({where:{id:link.id}});
    const existing=await tx.membership.findUnique({where:{workspaceId_userId:{workspaceId:link.workspaceId,userId:actor.id}}});
    if(existing?.active)return {workspaceId:link.workspaceId,state:'APPROVED'};
    requireThat(!link.revokedAt && link.expiresAt.getTime()>Date.now(),410,'EXPIRED','Join link expired or was revoked.');
    requireThat(link.uses<link.maxUses,409,'FULL','This join link has reached its usage limit.');
    const previous=await tx.joinRequest.findUnique({where:{linkId_userId:{linkId:link.id,userId:actor.id}}});
    requireThat(!previous || previous.state==='PENDING',409,'USED','This link was already used by this account. Ask for a new invitation.');
    const request=await tx.joinRequest.upsert({where:{linkId_userId:{linkId:link.id,userId:actor.id}},create:{linkId:link.id,userId:actor.id,state:link.requiresApproval?'PENDING':'APPROVED'},update:{}});
    if(!link.requiresApproval) {
      await grant(tx,link.workspaceId,actor.id,'MEMBER');
      await tx.joinLink.update({where:{id:link.id},data:{uses:{increment:1}}});
    }
    await record(tx,link.workspaceId,actor.id,link.requiresApproval?'join.requested':'join.accepted',request.id);
    return {workspaceId:link.workspaceId,state:request.state};
  });
}
export async function decide(actor:Actor,w:string,id:string,decision:'APPROVED'|'REJECTED',version:number) {
  return db.$transaction(async tx => {
    await lock(tx,w); await membership(tx,w,actor.id,true);
    const request=await tx.joinRequest.findFirst({where:{id,link:{workspaceId:w}},include:{link:true,user:true}});
    requireThat(request,404,'NOT_FOUND','Request not found.');
    requireThat(request.state==='PENDING' && request.version===version,409,'CONFLICT','Request changed. Refresh and try again.');
    if(decision==='APPROVED') {
      const link=request.link;
      requireThat(!link.revokedAt && link.expiresAt.getTime()>Date.now() && link.uses<link.maxUses,409,'LINK_CLOSED','The join link is expired, revoked or full.');
      requireThat(request.user.emailVerified,422,'UNVERIFIED','This user must verify their email.');
      const existing=await tx.membership.findUnique({where:{workspaceId_userId:{workspaceId:w,userId:request.userId}}});
      if(!existing?.active) {
        await grant(tx,w,request.userId,'MEMBER');
        await tx.joinLink.update({where:{id:link.id},data:{uses:{increment:1}}});
      }
    }
    await tx.joinRequest.update({where:{id},data:{state:decision,version:{increment:1}}});
    await record(tx,w,actor.id,'join.decided',id); return {state:decision};
  });
}
