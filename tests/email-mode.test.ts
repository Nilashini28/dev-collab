import {describe,it,expect} from 'vitest';
import {emailMode} from '../apps/api/src/email-mode';
const settings={NODE_ENV:'development',HOST:'127.0.0.1',DEV_INBOX:'false',EMAIL_PROVIDER:'smtp',SMTP_HOST:'smtp.provider.test'};
describe('honest SMTP mode labels',()=>{
 it('does not label a real SMTP provider as a test inbox',()=>expect(emailMode(settings)).toBe('smtp'));
 it('labels loopback SMTP as a local test',()=>expect(emailMode({...settings,SMTP_HOST:'localhost'})).toBe('local-test'));
 it('keeps the explicit development preview',()=>expect(emailMode({...settings,DEV_INBOX:'true'})).toBe('local-preview'));
 it('never enables preview in production',()=>expect(emailMode({...settings,NODE_ENV:'production',DEV_INBOX:'true'})).toBe('smtp'));
 it('preserves none and Resend modes',()=>{expect(emailMode({...settings,EMAIL_PROVIDER:'none'})).toBe('none');expect(emailMode({...settings,EMAIL_PROVIDER:'resend'})).toBe('resend');});
});
