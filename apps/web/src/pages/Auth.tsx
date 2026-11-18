import {oauthError} from '../oauth-errors';
import {signOut} from '../api';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api, authClient, errorText, queryClient } from '../api';
import { Brand, Field, Notice, Loading } from '../components';
import { registerInput, safeReturn } from '../../../../packages/contracts';
const titles:Record<string,string>={'login':'Welcome back.','register':'Your next chapter starts here.','verify-email':'Check your inbox.','forgot-password':'Let’s get you back in.','reset-password':'A fresh start.'};
export function AuthPage({mode}:{mode:string}){
 const [params]=useSearchParams();const navigate=useNavigate();
 const next=safeReturn(params.get('next')??sessionStorage.getItem('returnTo'));
 const caps=useQuery({queryKey:['capabilities'],queryFn:()=>api('/capabilities')});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [email,setEmail]=useState(sessionStorage.getItem('verificationEmail')??'');
 const [preview,setPreview]=useState<{url:string;subject:string}|null>(null);
 const resultError=(result:{error?:{message?:string}|null})=>{if(result.error)throw new Error(result.error.message??'Unable to continue.');};
 async function submit(event:React.FormEvent<HTMLFormElement>){
   event.preventDefault();setBusy(true);setError('');setMessage('');
   const values=Object.fromEntries(new FormData(event.currentTarget)) as Record<string,string>;
   try{
     if(mode==='register'){
       const input=registerInput.parse(values);
       resultError(await authClient.signUp.email({name:input.name,email:input.email,password:input.password,callbackURL:location.origin+next}));
       sessionStorage.setItem('verificationEmail',input.email);navigate('/verify-email?next='+encodeURIComponent(next));
     }else if(mode==='login'){
       const result=await authClient.signIn.email({email:values.email,password:values.password});
       if(result.error?.code==='EMAIL_NOT_VERIFIED'){
         sessionStorage.setItem('verificationEmail',values.email);navigate('/verify-email?next='+encodeURIComponent(next));return;
       }
       resultError(result);queryClient.clear();navigate(next);
     }else if(mode==='verify-email'){
       resultError(await authClient.sendVerificationEmail({email:values.email,callbackURL:location.origin+next}));
       setMessage('If this account needs verification, a new email has been queued. Check your inbox and spam folder.');
     }else if(mode==='forgot-password'){
       resultError(await authClient.requestPasswordReset({email:values.email,redirectTo:location.origin+'/reset-password'}));
       setMessage('If an account exists for that email, password-reset instructions have been queued.');
     }else{
       if(values.password!==values.confirmPassword)throw new Error('Passwords must match.');
       resultError(await authClient.resetPassword({newPassword:values.password,token:params.get('token')??''}));
       setMessage('Your password has been reset. You can sign in now.');
     }
   }catch(e){setError(e instanceof Error && e.name==='ZodError'?'Enter a valid name and email, and matching passwords of at least 12 characters.':errorText(e));}
   finally{setBusy(false);}
 }
 async function google(){
   setBusy(true);setError('');sessionStorage.setItem('returnTo',next);
   try{resultError(await authClient.signIn.social({provider:'google',callbackURL:location.origin+next,errorCallbackURL:location.origin+'/login?next='+encodeURIComponent(next)}));}catch(e){setError(errorText(e));setBusy(false);}
 }
 async function openLocalMail(){setError('');try{const response=await fetch('/api/dev/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Local inbox unavailable.');if(!result.data)throw new Error('No local message for this email yet.');setPreview(result.data);}catch(e){setError(errorText(e));}}
 const signup=mode==='register',login=mode==='login',reset=mode==='reset-password';
 return <main className="auth-layout"><aside className="auth-story"><Brand/><div><p className="eyebrow">YOUR PEOPLE. YOUR POSSIBILITIES.</p><h1>Great things<br/>start <span>together.</span></h1><p>One private workspace.<br/>A team that makes it yours.</p><div className="story-art"><div/><div/><div/></div></div><p className="auth-note"><ShieldCheck size={17}/> Your workspace is invitation-based.</p></aside><section className="auth-form-side"><Link to="/" className="back-link">← Back to DevCollab</Link><div className="auth-form"><p className="eyebrow">DEVCOLLAB</p><h2>{titles[mode]}</h2><p className="muted">{signup?'Create your account, then bring your team together.':login?'Sign in to pick up with your team.':mode==='verify-email'?'Verify your email to create or join a workspace. Follow the link in your email.':reset?'Choose a new DevCollab password.':'We’ll send a secure link to reset your password.'}</p>
 {caps.isLoading?<Loading/>:caps.isError?<Notice error>Cannot reach the server. Try again shortly.</Notice>:<>
 {!caps.data.data.email && !login && !reset && <Notice>Email delivery is not configured. This action is unavailable until setup is complete.</Notice>}
 {caps.data.data.emailMode==='local-test' && <Notice>Local email testing is enabled. Messages go to the configured test inbox, not real recipients.</Notice>}
 {caps.data.data.emailMode==='local-preview' && <Notice>Local preview inbox is enabled on this computer. Verification links appear here for testing; no email is delivered externally.</Notice>}
 {params.get('error') && <Notice error>{mode==='login'?oauthError(params.get('error')):'This link could not be verified. Request a fresh link.'}</Notice>}
 {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
 <form onSubmit={submit} key={mode}>
 {signup && <Field label="Your name"><input name="name" autoComplete="name" required minLength={2} maxLength={80} placeholder="How should we call you?"/></Field>}
 {!reset && <Field label="Email address"><input name="email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></Field>}
 {(signup||login||reset) && <Field label={signup?'Create a DevCollab password':'Password'}><input name="password" type="password" autoComplete={login?'current-password':'new-password'} required minLength={login?1:12} maxLength={128} placeholder={login?'Your password':'At least 12 characters'}/></Field>}
 {(signup||reset) && <Field label="Confirm password"><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>}
 {signup && <p className="helper">Use a new password for DevCollab, never your Gmail password.</p>}
 {login && <Link className="forgot" to="/forgot-password">Forgot password?</Link>}
 <button className="button full" disabled={busy||(!caps.data.data.email&&!login&&!reset)|| (reset&&!params.get('token'))}>{busy?'Please wait…':signup?'Create account':login?'Sign in':mode==='verify-email'?'Resend verification email':reset?'Reset password':'Send reset link'}<ArrowRight size={17}/></button>
 </form>
 {caps.data.data.emailMode==='local-preview'&&(mode==='verify-email'||mode==='forgot-password')&&<div className="local-inbox"><button className="button secondary full" type="button" disabled={!email} onClick={openLocalMail}>Open local test message</button>{preview&&<a className="button full" href={preview.url}>Continue with {preview.subject}</a>}</div>}
 {(signup||login) && <><div className="divider"><span>or</span></div><button className="button secondary full" disabled={busy||!caps.data.data.google} onClick={google}><span className="google-g" aria-hidden="true">G</span> Continue with Google</button>{!caps.data.data.google&&<p className="helper">Google sign-in is unavailable until the workspace host configures it.</p>}<p className="auth-switch">{login?'New to DevCollab?':'Already have an account?'} <Link to={(login?'/register':'/login')+'?next='+encodeURIComponent(next)}>{login?'Create an account':'Sign in'}</Link></p></>}
 {!(signup||login) && <p className="auth-switch"><Link to={'/login?next='+encodeURIComponent(next)}>Back to sign in</Link></p>}
 </>}
 </div><p className="auth-bottom">A little structure for your next big idea.</p></section></main>;
}
export function JoinPage({kind}:{kind:'invite'|'join'}){
 const navigate=useNavigate();const session=authClient.useSession();
 const [token]=useState(()=>{
   const raw=new URLSearchParams(location.hash.slice(1)).get('token');
   if(raw){sessionStorage.setItem(kind+'Token',raw);history.replaceState(null,'',location.pathname);}
   sessionStorage.setItem('returnTo','/'+kind);
   return raw??sessionStorage.getItem(kind+'Token')??'';
 });
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const intent=useQuery({queryKey:['invitation-intent',kind,token],queryFn:async()=>{const response=await fetch('/api/invitation-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,token})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Unable to remember this invitation.');sessionStorage.removeItem(kind+'Token');return result;},enabled:!!token,retry:false,staleTime:Infinity});
 const preview=useQuery({queryKey:['invitation-preview',kind,token],queryFn:()=>api(kind==='invite'?'/invitations/preview':'/join-links/preview','POST',{}),enabled:(!token||intent.isSuccess)&&!!session.data?.user.emailVerified,retry:false,staleTime:0});
 if(session.isPending||(token&&intent.isPending))return <Loading/>;
 if(intent.isError)return <main className="join-page"><Brand/><Notice error>{errorText(intent.error)}</Notice><button className="button" onClick={()=>intent.refetch()}>Try again</button></main>;
 if(!session.data)return <Navigate to={'/login?next=/'+kind} replace/>;
 if(!session.data.user.emailVerified)return <Navigate to={'/verify-email?next=/'+kind} replace/>;
 async function accept(){
   setBusy(true);setError('');
   try{
     const result=await api(kind==='invite'?'/invitations/accept':'/join-links/accept','POST',{});
     if(result.data.state==='PENDING'){setPending(true);}
     else{sessionStorage.removeItem(kind+'Token');sessionStorage.removeItem('returnTo');queryClient.clear();navigate('/w/'+result.data.workspaceId);}
   }catch(e){setError(errorText(e));}finally{setBusy(false);}
 }
 const details=preview.data?.data,available=details&&['PENDING','ACCEPTED'].includes(details.state);
 return <main className="join-page"><Brand/><section className="join-card"><ShieldCheck size={36}/><h1>{pending?'Your request is with the team.':details?'Join '+details.workspaceName:'Review your invitation.'}</h1><p>{pending?'An owner or admin needs to approve your request. You can check your workspace list or try again after approval.':'Review the workspace and access before accepting.'}</p><p className="muted">Signed in as {session.data.user.email}</p>{preview.isFetching&&<Loading/>}{preview.isError&&<Notice error>{errorText(preview.error)}</Notice>}{details&&<div className="invitation-details"><strong>{details.workspaceName}</strong><p>Offered role: <b>{details.role.toLowerCase()}</b></p><p>{details.requiresApproval?'An owner or admin must approve your request.':'Acceptance adds you to this workspace.'}</p><small>Expires {new Date(details.expiresAt).toLocaleString()}</small>{!available&&<Notice error>This invitation is {details.state.toLowerCase()}. Ask the team for a new link.</Notice>}</div>}{error&&<Notice error>{error}</Notice>}{<button className="button full" onClick={accept} disabled={busy||!available}>{busy?'Checking invitation…':pending?'Check approval':details?.state==='ACCEPTED'?'Open workspace':'Accept invitation'}<ArrowRight size={18}/></button>}<Link to="/workspaces">Go to my workspaces</Link><button className="link-button" onClick={async()=>{try{await signOut();navigate('/login?next=/'+kind);}catch(e){setError(errorText(e));}}}>Use a different account</button></section></main>;
}



