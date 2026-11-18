// Provider acceptance is not proof of delivery to the recipient's inbox.
export function smtpConfirmation(result:{accepted?:unknown[];rejected?:unknown[];messageId?:string},recipient:string):string {
  const accepted=result.accepted?.some(value=>{
    const address=typeof value==='string'?value:(value as {address?:string})?.address;
    return address?.toLowerCase()===recipient.toLowerCase();
  });
  if(!accepted || result.rejected?.length || !result.messageId?.trim())throw new Error('PROVIDER_REJECTED');
  return result.messageId;
}
export function resendConfirmation(result:unknown):string {
  const id=(result as {id?:unknown}|null)?.id;
  if(typeof id!=='string'||!id.trim())throw new Error('PROVIDER_INVALID_RESPONSE');
  return id;
}
