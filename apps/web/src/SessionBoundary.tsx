import {useEffect,useState,type ReactNode} from 'react';
import {authClient,queryClient} from './api';
// A session change unmounts private screens before a new identity can reuse cached records.
export function SessionBoundary({children}:{children:ReactNode}){
 const session=authClient.useSession();const identity=session.data?.user.id??null;
 const [cachedIdentity,setCachedIdentity]=useState<string|null|undefined>(undefined);
 useEffect(()=>{
  if(session.isPending)return;
  if(cachedIdentity!==identity){queryClient.clear();window.dispatchEvent(new Event('devcollab:disconnect'));setCachedIdentity(identity);}
 },[identity,session.isPending,cachedIdentity]);
 useEffect(()=>{
  const refresh=()=>{void session.refetch();};
  const expired=()=>{authClient.hydrateSession(null);queryClient.clear();window.dispatchEvent(new Event('devcollab:disconnect'));};
  const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);window.addEventListener('devcollab:unauthorized',expired);
  return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);window.removeEventListener('devcollab:unauthorized',expired);};
 },[session.refetch]);
 if(session.isPending||cachedIdentity!==identity)return <div className="loading" role="status">Checking session…</div>;
 return children;
}
