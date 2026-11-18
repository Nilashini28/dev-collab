import {deliverEmail} from '../apps/worker/src/deliver-email';
import {describe,it,expect} from 'vitest';
import {smtpConfirmation,resendConfirmation} from '../apps/worker/src/email-confirmation';
describe('provider acceptance evidence',()=>{
  it('requires SMTP acceptance of the intended recipient',()=>{
    expect(smtpConfirmation({accepted:['PERSON@example.test'],rejected:[],messageId:'smtp-id'},'person@example.test')).toBe('smtp-id');
    expect(()=>smtpConfirmation({accepted:['other@example.test'],messageId:'id'},'person@example.test')).toThrow();
    expect(()=>smtpConfirmation({accepted:[],rejected:['person@example.test'],messageId:'id'},'person@example.test')).toThrow();
  });
  it('requires a nonempty Resend provider ID even after HTTP success',()=>{
    expect(resendConfirmation({id:'provider-id'})).toBe('provider-id');
    for(const body of [null,{}, {id:''},{id:12},{error:'rejected'}])expect(()=>resendConfirmation(body)).toThrow();
  });
});

it('sends via the configured provider and rejects transport failures',async()=>{
 const mail={to:'safe@example.test',subject:'Test',text:'Fixture'},settings={EMAIL_PROVIDER:'resend' as const,EMAIL_FROM:'sender@example.test',RESEND_API_KEY:'fixture-only'};
 const transport={sendMail:async()=>({accepted:[mail.to],messageId:'smtp-id'})};
 let headers:HeadersInit|undefined;
 expect(await deliverEmail(mail,'delivery-1',settings,transport,async(_url,init)=>{headers=init?.headers;return new Response(JSON.stringify({id:'resend-id'}),{status:200});})).toBe('resend-id');
 expect(headers).toMatchObject({'Idempotency-Key':'delivery-1'});
 await expect(deliverEmail(mail,'id',settings,transport,async()=>new Response('{}',{status:403}))).rejects.toThrow('PROVIDER_REJECTED');
 await expect(deliverEmail(mail,'id',settings,transport,async()=>new Response('{}',{status:200}))).rejects.toThrow();
 expect(await deliverEmail(mail,'id',{...settings,EMAIL_PROVIDER:'smtp'},transport)).toBe('smtp-id');
 await expect(deliverEmail(mail,'id',{...settings,EMAIL_PROVIDER:'smtp'},{sendMail:async()=>{throw new Error('SMTP refused');}})).rejects.toThrow('SMTP refused');
});
