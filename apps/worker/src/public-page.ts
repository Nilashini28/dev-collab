import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
export function isPublicAddress(address:string){
 try{return ipaddr.process(address).range()==='unicast';}catch{return false;}
}
export async function publicPage(raw:string,redirects=0):Promise<{url:string;text:string}>{
 const url=new URL(raw);
 if(url.protocol!=='https:' || url.username || url.password || (url.port&&url.port!=='443') || redirects>3)throw new Error('UNSAFE_URL');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 let dnsTimer:ReturnType<typeof setTimeout>|undefined;
 const addresses=await Promise.race([lookup(hostname,{all:true}),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS_TIMEOUT')),5000);})]).finally(()=>clearTimeout(dnsTimer));
 if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('UNSAFE_DESTINATION');
 const address=addresses[0];
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{headers:{'User-Agent':'DevCollab-DeadlineReview/1.0','Accept':'text/html, text/plain'},lookup:((_host:any,options:any,callback:any)=>options.all?callback(null,[address]):callback(null,address.address,address.family)) as any},response=>{
   if(response.statusCode&&[301,302,303,307,308].includes(response.statusCode)){
    response.resume();if(!response.headers.location){reject(new Error('MISSING_REDIRECT'));return;}
    publicPage(new URL(response.headers.location,url).href,redirects+1).then(resolve,reject);return;
   }
   if(response.statusCode!==200){response.resume();reject(new Error('PAGE_UNAVAILABLE'));return;}
   if(!/^text\/(html|plain)(;|$)/i.test(response.headers['content-type']??'')){response.resume();reject(new Error('UNSUPPORTED_CONTENT'));return;}
   let size=0;const chunks:Buffer[]=[];
   response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1024*1024){request.destroy(new Error('PAGE_TOO_LARGE'));return;}chunks.push(chunk);});
   response.on('end',()=>resolve({url:url.href,text:Buffer.concat(chunks).toString('utf8')}));
   response.on('error',reject);
  });
  const deadline=setTimeout(()=>request.destroy(new Error('PAGE_TIMEOUT')),10000);
  request.on('close',()=>clearTimeout(deadline));request.on('error',reject);
 });
}
export function deadlineEvidence(html:string){
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
 const matches=[...text.matchAll(/.{0,100}(?:deadline|submission|register|registration|round|proposal).{0,240}/gi)].slice(0,8).map(m=>m[0]);
 const candidates=[...new Set(text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g)??[])].filter(s=>Number.isFinite(Date.parse(s))).slice(0,10);
 return {excerpt:(matches.join('\n\n')||text.slice(0,2000)).slice(0,3000),candidates,state:matches.length||candidates.length?'NEEDS_REVIEW':'NO_DEADLINE'};
}
