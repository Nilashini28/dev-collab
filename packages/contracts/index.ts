import { z } from 'zod';
export const role = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
export const grantRole = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);
export const workspaceInput = z.object({ name: z.string().trim().min(2).max(80) });
export const versionInput = z.object({ expectedVersion: z.number().int().positive() });
export const memberInput = versionInput.extend({ role: grantRole });
export const invitationInput = z.object({
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(20),
  role: grantRole.default('MEMBER'),
});
export const linkInput = z.object({
  days: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(100).default(4),
  requiresApproval: z.boolean().default(false),
});
export const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export const decisionInput = versionInput.extend({ decision: z.enum(['APPROVED', 'REJECTED']) });
export const transferInput = versionInput.extend({ targetUserId: z.string().min(1).max(128) });
export const registerInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(12).max(128),
  confirmPassword: z.string(),
}).refine(v => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords must match.' });
export type Role = z.infer<typeof role>;
export function mayManage(actor: Role) { return actor === 'OWNER' || actor === 'ADMIN'; }
export function mayChange(actor: Role, target: Role, next?: Role) {
  if (target === 'OWNER' || next === 'OWNER') return false;
  return actor === 'OWNER' || (actor === 'ADMIN' && target !== 'ADMIN' && next !== 'ADMIN');
}
export function safeReturn(value: unknown): string {
  return typeof value === 'string' && /^\/(workspaces|w\/[a-zA-Z0-9-]+|invite|join)(\?[^#\\]*)?$/.test(value) ? value : '/workspaces';
}
export const taskStatus=z.enum(['TODO','IN_PROGRESS','IN_REVIEW','DONE']);
export const hackathonInput=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(4000).default(''),officialUrl:z.url().refine(v=>v.startsWith('https://'),'Use HTTPS.').optional().or(z.literal(''))});
export const taskInput=z.object({
 title:z.string().trim().min(2).max(160),description:z.string().max(10000).default(''),
 priority:z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),status:taskStatus.default('TODO'),
 assigneeId:z.string().max(128).nullable().default(null),sprintId:z.string().max(128).nullable().default(null),
 labels:z.array(z.string().trim().min(1).max(30)).max(10).default([]),
 dueAt:z.iso.datetime().nullable().default(null),
});
// Defaults belong to creation only. Optional wrapped defaults would reset omitted fields.
export const taskPatch=z.object({
 title:taskInput.shape.title.optional(),description:taskInput.shape.description.removeDefault().optional(),
 priority:taskInput.shape.priority.removeDefault().optional(),status:taskInput.shape.status.removeDefault().optional(),
 assigneeId:taskInput.shape.assigneeId.removeDefault().optional(),sprintId:taskInput.shape.sprintId.removeDefault().optional(),
 labels:taskInput.shape.labels.removeDefault().optional(),dueAt:taskInput.shape.dueAt.removeDefault().optional(),
 expectedVersion:z.number().int().positive(),
});
export const sprintInput=z.object({name:z.string().trim().min(2).max(80),goal:z.string().max(2000).default(''),startAt:z.iso.datetime(),endAt:z.iso.datetime()}).refine(v=>new Date(v.endAt)>new Date(v.startAt),'End must follow start.');
export const deadlineInput=z.object({instant:z.iso.datetime(),timezone:z.string().refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use an IANA timezone.'),sourceUrl:z.url().optional(),sourceExcerpt:z.string().max(3000).optional(),expectedVersion:z.number().int().nonnegative()});

export const timezoneInput=z.string().refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid IANA timezone.');
export const webUrl=z.string().trim().max(2000).refine(value=>!value||/^https?:\/\//.test(value)&&(()=>{try{new URL(value);return true;}catch{return false;}})(),'Enter an HTTP or HTTPS URL.');
export const eventInput=hackathonInput.extend({startAt:z.iso.datetime().nullable().default(null),endAt:z.iso.datetime().nullable().default(null),timezone:timezoneInput.default('UTC'),format:z.enum(['ONLINE','OFFLINE']).default('ONLINE'),venue:z.string().trim().max(500).default(''),participationDetails:z.string().trim().max(2000).default('')}).refine(v=>!v.endAt||!!v.startAt&&new Date(v.endAt)>new Date(v.startAt),'Event end must follow its start.').refine(v=>v.format!=='OFFLINE'||v.venue.length>0,'Add the venue for an offline event.');
export const projectDetailsInput=z.object({name:z.string().trim().min(2).max(100),description:z.string().trim().max(4000),repositoryUrl:webUrl.default(''),demoUrl:webUrl.default(''),status:z.enum(['IDEA','BUILDING','READY','SUBMITTED','ON_HOLD']),expectedVersion:z.number().int().positive()});
export function eventTiming(start:string|null,end:string|null,now=Date.now()){
 if(!start)return {status:'Unscheduled',remaining:0};
 const first=Date.parse(start),last=end?Date.parse(end):first;
 return {status:now<first?'Upcoming':!end?'Started':now<last?'Live':'Past',remaining:Math.max(0,first-now)};
}
