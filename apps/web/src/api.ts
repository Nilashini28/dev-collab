import { createAuthClient } from 'better-auth/react';
import { QueryClient } from '@tanstack/react-query';
export const authClient=createAuthClient();
export const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:10000,refetchOnWindowFocus:true}}});
export class ApiError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export async function api<T=any>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch('/api/v1'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok){
    if(response.status===401){queryClient.clear();window.dispatchEvent(new Event('devcollab:unauthorized'));}
    if(response.status===404 && path.startsWith('/workspaces/'))queryClient.removeQueries({queryKey:['workspace',path.split('/')[2]]});
    throw new ApiError(response.status,result.error?.code??'ERROR',result.error?.message??'Request failed.');
  }
  return result;
}
export function errorText(error:unknown){return error instanceof Error?error.message:'Something went wrong. Please try again.';}
export async function signOut(){
 const result=await authClient.signOut();
 if(result.error)throw new Error('Sign out could not be confirmed. Check your connection and try again.');
 authClient.hydrateSession(null);queryClient.clear();window.dispatchEvent(new Event('devcollab:disconnect'));
}
