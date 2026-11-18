import {useState} from 'react';
import {Link,Navigate,useSearchParams} from 'react-router';
import {useQuery} from '@tanstack/react-query';
import {api,authClient,errorText} from '../api';
import {Brand,Notice,Loading} from '../components';
import {oauthError} from '../oauth-errors';
export function Account(){
 const session=authClient.useSession(),[params]=useSearchParams();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const caps=useQuery({queryKey:['capabilities'],queryFn:()=>api('/capabilities')});
 const accounts=useQuery({queryKey:['linked-accounts',session.data?.user.id],enabled:!!session.data,queryFn:async()=>{const result=await authClient.listAccounts();if(result.error)throw Error(result.error.message??'Unable to load sign-in methods.');return result.data;}});
 if(session.isPending)return <Loading/>;if(!session.data)return <Navigate to="/login?next=/account"/>;
 const linked=accounts.data?.some(a=>a.providerId==='google');
 async function connect(){setBusy(true);setError('');try{const r=await authClient.linkSocial({provider:'google',callbackURL:location.origin+'/account',errorCallbackURL:location.origin+'/account'});if(r.error)throw Error(r.error.message??'Unable to start Google linking.');}catch(e){setError(errorText(e));setBusy(false);}}
 return <main className="standalone"><Brand/><section className="section-panel" style={{maxWidth:680,margin:'40px auto'}}><h1>Account sign-in methods</h1><p>Signed in as {session.data.user.email}</p>{error&&<Notice error>{error}</Notice>}{params.get('error')&&<Notice error>{oauthError(params.get('error'))}</Notice>}{accounts.isError&&<Notice error>{errorText(accounts.error)}</Notice>}{caps.isError&&<Notice error>{errorText(caps.error)}</Notice>}
 <h2>Google</h2>{accounts.isLoading?<Loading/>:linked?<Notice>Google is connected to this account. You can use Continue with Google on the sign-in page.</Notice>:<><p>Connect the Google account with this same verified email. Existing tasks, workspaces and invitations stay attached to your current DevCollab account.</p><button className="button" disabled={busy||!session.data.user.emailVerified||!caps.data?.data.google||accounts.isError||accounts.isLoading} onClick={()=>void connect()}>{busy?'Connecting…':'Connect Google'}</button></>}
 {!caps.isLoading&&!caps.data?.data.google&&<p className="helper">The host must configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server before Google can be connected.</p>}
 <p className="helper">Accounts are never automatically merged by email. Linking requires your signed-in session and a matching verified Google identity. Your DevCollab password stays available. Unlinking is not offered here to avoid accidental lockout.</p><Link className="link-button" to="/workspaces">Back to workspaces</Link></section></main>;
}
