import { db } from '../../../packages/db';
import { publicPage, deadlineEvidence } from './public-page';
export async function extractDeadline(id:string){
 const proposal=await db.deadlineProposal.findUnique({where:{id},include:{project:{include:{hackathon:true}}}});
 if(!proposal||proposal.state!=='QUEUED')return;
 try{
  const page=await publicPage(proposal.sourceUrl),evidence=deadlineEvidence(page.text);
  await db.deadlineProposal.update({where:{id},data:{...evidence,sourceUrl:page.url,fetchedAt:new Date()}});
 }catch(error){
  const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'FETCH_FAILED';
  await db.deadlineProposal.update({where:{id},data:{state:'FAILED',errorCode:code,fetchedAt:new Date()}});
 }
}
