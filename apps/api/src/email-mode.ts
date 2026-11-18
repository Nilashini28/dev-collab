type Settings={NODE_ENV:string;HOST:string;DEV_INBOX:string;EMAIL_PROVIDER:string;SMTP_HOST:string};
export function emailMode(settings:Settings){
 if(settings.NODE_ENV==='development'&&settings.HOST==='127.0.0.1'&&settings.DEV_INBOX==='true')return 'local-preview';
 const local=['localhost','127.0.0.1','::1','[::1]','mailpit'].includes(settings.SMTP_HOST.toLowerCase());
 return settings.EMAIL_PROVIDER==='smtp'&&settings.NODE_ENV!=='production'&&local?'local-test':settings.EMAIL_PROVIDER;
}
