import {smtpConfirmation,resendConfirmation} from './email-confirmation';
type Mail={to:string;subject:string;text:string};
type Settings={EMAIL_PROVIDER:'none'|'smtp'|'resend';EMAIL_FROM:string;RESEND_API_KEY?:string};
export async function deliverEmail(mail:Mail,id:string,settings:Settings,smtp:{sendMail:(mail:any)=>Promise<any>},request:typeof fetch=fetch){
 if(settings.EMAIL_PROVIDER==='smtp')return smtpConfirmation(await smtp.sendMail({from:settings.EMAIL_FROM,...mail,messageId:'<'+id+'@devcollab.local>'}),mail.to);
 if(settings.EMAIL_PROVIDER!=='resend'||!settings.RESEND_API_KEY)throw new Error('EMAIL_UNAVAILABLE');
 const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+settings.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:settings.EMAIL_FROM,...mail}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('PROVIDER_REJECTED');
 return resendConfirmation(await response.json());
}
