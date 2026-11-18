import {ingestDocument} from './documents';
import {deliverEmail} from './deliver-email';
import {generateReview} from './ai';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import { db } from '../../../packages/db';
import { config, capabilities } from '../../api/src/config';
import { decrypt } from '../../api/src/email';
import { dispatchReminders } from '../../api/src/planning';
import { extractDeadline } from './deadlines';
import {syncRepository} from '../../api/src/github';
const connection=new Redis(config.REDIS_URL,{maxRetriesPerRequest:null});
connection.on('error',()=>console.error('Redis connection unavailable.'));
const queue=new Queue('devcollab-email',{connection});
const extractionQueue=new Queue('devcollab-extraction',{connection});
const extractionWorker=new Worker('devcollab-extraction',job=>extractDeadline(job.data.proposalId),{connection,concurrency:2});
extractionWorker.on('error',()=>console.error('Extraction worker unavailable.'));
const githubQueue=new Queue('devcollab-github',{connection});
const githubWorker=new Worker('devcollab-github',job=>syncRepository(job.data.connectionId,job.attemptsMade>=2),{connection,concurrency:2});
githubWorker.on('error',()=>console.error('GitHub worker unavailable.'));
const documentQueue=new Queue('devcollab-documents',{connection});
const documentWorker=new Worker('devcollab-documents',job=>ingestDocument(job.data.id),{connection,concurrency:1});
documentWorker.on('error',()=>console.error('Document worker unavailable.'));
const aiQueue=new Queue('devcollab-ai',{connection});
const aiWorker=new Worker('devcollab-ai',job=>generateReview(job.data.id),{connection,concurrency:1});
aiWorker.on('error',()=>console.error('AI worker unavailable.'));
const smtp=nodemailer.createTransport({
  host:config.SMTP_HOST,port:config.SMTP_PORT,secure:config.SMTP_SECURE==='true',
  ...(config.SMTP_USER?{auth:{user:config.SMTP_USER,pass:config.SMTP_PASSWORD}}:{}),
  connectionTimeout:10000,socketTimeout:15000,
});
const worker=new Worker('devcollab-email',async job=>{
  if(config.EMAIL_PROVIDER==='none')return;
  const delivery=await db.emailDelivery.findUnique({where:{id:job.data.deliveryId}});
  if(!delivery || delivery.state!=='QUEUED')return;
  if(delivery.attempts>=5){
    await db.emailDelivery.update({where:{id:delivery.id},data:{state:'FAILED',encryptedPayload:null,errorCode:'RETRIES_EXHAUSTED'}});return;
  }
  if(delivery.expiresAt.getTime()<Date.now()){
    await db.emailDelivery.update({where:{id:delivery.id},data:{state:'CANCELLED',encryptedPayload:null,errorCode:'EXPIRED'}});return;
  }
  if(delivery.invitationId){
    const invite=await db.invitation.findUnique({where:{id:delivery.invitationId}});
    if(!invite || invite.revokedAt || invite.acceptedAt){
      await db.emailDelivery.update({where:{id:delivery.id},data:{state:'CANCELLED',encryptedPayload:null}});return;
    }
  }
  await db.emailDelivery.update({where:{id:delivery.id},data:{attempts:{increment:1}}});
  try{
    if(!capabilities.email || !delivery.encryptedPayload)throw new Error('UNAVAILABLE');
    const mail=decrypt(delivery.encryptedPayload);
    const providerId=await deliverEmail(mail,delivery.id,config,smtp);
    await db.emailDelivery.updateMany({where:{id:delivery.id,state:'QUEUED'},data:{state:'PROVIDER_ACCEPTED',providerId,encryptedPayload:null,errorCode:null}});
  }catch{
    const final=job.attemptsMade+1 >= 5;
    await db.emailDelivery.updateMany({where:{id:delivery.id,state:'QUEUED'},data:{errorCode:'DELIVERY_FAILED',...(final?{state:'FAILED',encryptedPayload:null}:{})}});
    throw new Error('Email delivery failed.');
  }
},{connection,concurrency:3});
worker.on('error',()=>console.error('Email worker unavailable.'));
worker.on('failed',job=>console.error(JSON.stringify({event:'email.retry-or-failure',jobId:job?.id})));
let dispatching=false;
async function dispatch(){
  if(dispatching)return;dispatching=true;
  try{
    await dispatchReminders();
    const deliveriesFromGithub=await db.githubDelivery.findMany({where:{state:'QUEUED'},take:100});
    for(const delivery of deliveriesFromGithub)await db.$transaction(async tx=>{
      if(delivery.installationId)await tx.repositoryConnection.updateMany({where:{installationId:delivery.installationId,...(delivery.repositoryId?{repositoryId:delivery.repositoryId}:{}),state:{in:['READY','FAILED']}},data:{state:'QUEUED'}});
      await tx.githubDelivery.update({where:{id:delivery.id},data:{state:'PROCESSED'}});
    });
    // Reconcile missed webhooks hourly for approved active connections.
    await db.repositoryConnection.updateMany({where:{state:'READY',syncedAt:{lt:new Date(Date.now()-3600000)}},data:{state:'QUEUED'}});
    // Respect the provider's reset time rather than hammering a limited installation.
    for(const limited of await db.repositoryConnection.findMany({where:{state:'RATE_LIMITED'},take:100})){
      const reset=Number(limited.errorCode?.replace('RATE_LIMITED_',''));
      if(reset&&reset<=Date.now())await db.repositoryConnection.updateMany({where:{id:limited.id,state:'RATE_LIMITED',errorCode:limited.errorCode},data:{state:'QUEUED',errorCode:null}});
    }
    const repositories=await db.repositoryConnection.findMany({where:{state:'QUEUED'},take:30});
    for(const repo of repositories)await githubQueue.add('sync',{connectionId:repo.id},{jobId:repo.id,attempts:3,backoff:{type:'exponential',delay:10000},removeOnComplete:true,removeOnFail:true});
    const proposals=await db.deadlineProposal.findMany({where:{state:'QUEUED'},take:50,orderBy:{createdAt:'asc'}});
    for(const proposal of proposals)await extractionQueue.add('extract',{proposalId:proposal.id},{jobId:proposal.id,attempts:3,backoff:{type:'exponential',delay:2000},removeOnComplete:true,removeOnFail:true});
    for(const doc of await db.document.findMany({where:{state:'QUEUED'},take:20}))await documentQueue.add('parse',{id:doc.id},{jobId:doc.id,removeOnComplete:true,removeOnFail:true});
    for(const run of await db.aiRun.findMany({where:{state:'QUEUED'},take:20}))await aiQueue.add('review',{id:run.id},{jobId:run.id,removeOnComplete:true,removeOnFail:true});
    // Database recovery also restores queued work after Redis loss.
    const deliveries=await db.emailDelivery.findMany({where:{state:'QUEUED',expiresAt:{gt:new Date()}},take:100,orderBy:{createdAt:'asc'}});
    if(config.EMAIL_PROVIDER!=='none')for(const delivery of deliveries)await queue.add('send',{deliveryId:delivery.id},{jobId:delivery.id,attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:true,removeOnFail:true});
    await db.emailDelivery.updateMany({where:{state:'QUEUED',expiresAt:{lt:new Date()}},data:{state:'CANCELLED',encryptedPayload:null,errorCode:'EXPIRED'}});
    await db.outboxEvent.updateMany({where:{publishedAt:null},data:{publishedAt:new Date()}});
  }catch{console.error('Outbox dispatch failed; retrying.');}
  finally{dispatching=false;}
}
const timer=setInterval(dispatch,5000);void dispatch();
async function shutdown(){clearInterval(timer);await worker.close();await documentWorker.close();await aiWorker.close();await documentQueue.close();await aiQueue.close();await extractionWorker.close();await githubWorker.close();await queue.close();await extractionQueue.close();await githubQueue.close();await connection.quit();await db.$disconnect();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);


