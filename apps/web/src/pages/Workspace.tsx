import {ChatShortcut} from '../ChatShortcut';
import {ChatPanel} from './Collaboration';
import {SprintHub} from './SprintDashboard';
import {signOut} from '../api';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useLocation } from 'react-router';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUpRight, Plus, Users, LayoutGrid, Settings2, LogOut, ChevronDown, Mail, Link2, ShieldCheck, ArrowRight, Copy, X, FolderOpen, Timer } from 'lucide-react';
import { api, authClient, queryClient, errorText } from '../api';
import { Brand, Field, Notice, Loading, Empty, TeamSculpture } from '../components';
import { invitationInput, mayChange, mayManage } from '../../../../packages/contracts';
import { Hackathons } from './Planning';
type Row=Record<string,any>;
function useList(path:string,enabled=true){
 return useInfiniteQuery({queryKey:['list',path],initialPageParam:'',enabled,
  queryFn:({pageParam})=>api<{items:Row[];nextCursor:string|null}>(path+(pageParam?'?cursor='+encodeURIComponent(pageParam):'')),
  getNextPageParam:page=>page.nextCursor??undefined,refetchInterval:15000,
 });
}
function More({query}:{query:ReturnType<typeof useList>}){return query.hasNextPage?<button className="button secondary small" disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>Load more</button>:null;}
function rows(query:ReturnType<typeof useList>){return query.data?.pages.flatMap(p=>p.items)??[];}
export function Chooser(){
 const session=authClient.useSession();const navigate=useNavigate();
 const workspaces=useList('/workspaces',!!session.data?.user.emailVerified);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(session.isPending)return <Loading/>;
 if(!session.data)return <Navigate to="/login"/>;
 if(!session.data.user.emailVerified)return <Navigate to="/verify-email"/>;
 async function create(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');
  try{const result=await api('/workspaces','POST',{name:new FormData(event.currentTarget).get('name')});await queryClient.invalidateQueries();navigate('/w/'+result.data.id);}
  catch(e){setError(errorText(e));}finally{setBusy(false);}
 }
 return <main className="chooser"><nav className="public-nav"><Brand/><Link className="link-button" to="/account">Account</Link><button className="link-button" onClick={async()=>{try{await signOut();navigate('/login');}catch(e){setError(errorText(e));}}}>Sign out</button></nav><div className="chooser-content"><p className="eyebrow">YOUR STARTING POINT</p><h1>Find your people.<br/>Make your space.</h1><p className="lead">Welcome, {session.data.user.name}. Choose a workspace or start a new one.</p><div className="chooser-grid"><section><h2>Your workspaces <span className="muted">/</span></h2>{workspaces.isLoading?<Loading/>:workspaces.isError?<Notice error>{errorText(workspaces.error)}</Notice>:rows(workspaces).length?rows(workspaces).map(w=><Link className="workspace-card" to={'/w/'+w.workspaceId} key={w.id}><span className="workspace-avatar">{w.name.slice(0,1).toUpperCase()}</span><div><h3>{w.name}</h3><span className="muted">{w.role.toLowerCase()}</span></div><ArrowUpRight/></Link>):<Empty title="Your next team is waiting.">Create a workspace below, or open the invitation link your team shared with you.</Empty>}<More query={workspaces}/></section><section className="create-panel"><span className="icon-tile"><Plus/></span><h2>A new beginning.</h2><p className="muted">Create a private workspace and invite your teammates. You’ll be its owner.</p>{error&&<Notice error>{error}</Notice>}<form onSubmit={create}><Field label="Workspace name"><input name="name" required minLength={2} maxLength={80} placeholder="e.g. Weekend Builders"/></Field><button className="button full" disabled={busy}>{busy?'Creating…':'Create workspace'}<ArrowRight size={17}/></button></form></section></div></div></main>;
}
export function Workspace(){
 const {workspaceId:w=''}=useParams();const location=useLocation();const navigate=useNavigate();const session=authClient.useSession();
 const [modal,setModal]=useState(false),[tab,setTab]=useState<'email'|'link'>('email');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[newLink,setNewLink]=useState('');
 useEffect(()=>{
  if(!modal)return;
  const previous=document.activeElement as HTMLElement|null;
  const trap=(event:KeyboardEvent)=>{
   if(event.key!=='Tab')return;
   const elements=Array.from(document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input:not(:disabled),.modal select:not(:disabled),.modal textarea:not(:disabled),.modal a[href]'));
   const first=elements[0],last=elements.at(-1);
   if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
   if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',trap);
  return ()=>{document.removeEventListener('keydown',trap);previous?.focus();};
 },[modal]);
 const team=location.pathname.endsWith('/members'),chat=location.pathname.endsWith('/chat'),sprints=location.pathname.endsWith('/sprints');
 const workspace=useQuery({queryKey:['workspace',w],queryFn:()=>api('/workspaces/'+w),enabled:!!session.data?.user.emailVerified,refetchInterval:10000});
 const current=workspace.data?.data;
 const members=useList('/workspaces/'+w+'/members',!!current&&!chat&&!sprints);
 const manage=!!current&&mayManage(current.role);
 const invitations=useList('/workspaces/'+w+'/invitations',manage&&team);
 const links=useList('/workspaces/'+w+'/join-links',manage&&team);
 const requests=useList('/workspaces/'+w+'/join-requests',manage&&team);
 const caps=useQuery({queryKey:['capabilities'],queryFn:()=>api('/capabilities')});
 async function mutate(path:string,method:string,body?:unknown){
  setBusy(true);setError('');setNotice('');
  try{const result=await api(path,method,body);await queryClient.invalidateQueries();return result;}
  catch(e){setError(errorText(e));return null;}finally{setBusy(false);}
 }
 async function invite(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();const data=new FormData(event.currentTarget);
  if(tab==='email'){
   let input;
   try{input=invitationInput.parse({emails:String(data.get('emails')).split(/[,;]+/).map(v=>v.trim()).filter(Boolean),role:data.get('role')});}
   catch{setError('Enter valid email addresses separated by commas (up to 20).');return;}
   const result=await mutate('/workspaces/'+w+'/invitations','POST',input);
   if(result){
    if(caps.data?.data.emailMode==='local-preview'){setModal(false);setNotice('Saved to the development inbox only. No invitation email was sent.');return;}
    setBusy(true);setNotice('Waiting for the email provider to confirm acceptance…');
    try{
     const ids=new Set(result.data.map((i:Row)=>i.id));let complete=false;
     for(let attempt=0;attempt<20;attempt++){
      const status=await api('/workspaces/'+w+'/invitation-deliveries','POST',{ids:[...ids]});
      const deliveries:Row[]=status.items;
      if(deliveries.some(i=>['FAILED','CANCELLED'].includes(i.state)))throw new Error('The provider could not send an invitation. Check delivery status, ask the host to verify mail settings, then use Resend.');
      if(deliveries.length===ids.size&&deliveries.every(i=>i.state==='PROVIDER_ACCEPTED')){complete=true;break;}
      if(deliveries.some(i=>i.errorCode))throw new Error('The email provider failed to accept the request. The worker will retry. Check the provider credentials and sender domain; do not submit a duplicate invitation.');
      await new Promise(resolve=>setTimeout(resolve,1500));
     }
     setModal(false);setNotice(complete?'Email provider accepted all invitations. Inbox delivery may take a moment.':'Invitations are pending provider confirmation. Check the delivery column; verify Redis and the email worker are running.');
    }catch(e){setNotice('');setError(errorText(e));}finally{setBusy(false);await queryClient.invalidateQueries();}
   }
  }else{
   const result=await mutate('/workspaces/'+w+'/join-links','POST',{days:Number(data.get('days')),maxUses:Number(data.get('maxUses')),requiresApproval:data.get('approval')==='on'});
   if(result)setNewLink(result.data.url);
  }
 }
 if(session.isPending)return <Loading/>;
 if(!session.data)return <Navigate to="/login"/>;
 if(!session.data.user.emailVerified)return <Navigate to="/verify-email"/>;
 if(workspace.isLoading)return <Loading/>;
 if(workspace.isError)return <main className="standalone"><Brand/><Notice error>{errorText(workspace.error)}</Notice><Link to="/workspaces">Back to workspaces</Link></main>;
 if(!current)return null;
 return <main className="app-shell"><aside className="sidebar"><Brand/><Link className="workspace-switch" to="/workspaces"><span className="workspace-avatar small-avatar">{current.name[0].toUpperCase()}</span><span>{current.name}<small>Private workspace</small></span><ChevronDown size={16}/></Link><p className="nav-label">WORKSPACE</p><nav><Link className={!team&&!chat&&!sprints?'active':''} to={'/w/'+w}><LayoutGrid size={18}/>Overview</Link><Link className={team?'active':''} to={'/w/'+w+'/settings/members'}><Users size={18}/>Team & access<span className="nav-count">{current.memberCount}</span></Link><ChatShortcut workspaceId={w} active={chat}/><Link className={sprints?'active':''} to={'/w/'+w+'/sprints'}><Timer size={18}/>Sprints</Link></nav><div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={21}/><strong>A space that’s yours.</strong><p>Only your team can access this workspace.</p></div><button onClick={async()=>{try{await signOut();navigate('/login');}catch(e){setError(errorText(e));}}}><LogOut size={17}/>Sign out</button><div className="profile"><span>{session.data.user.name[0].toUpperCase()}</span><div>{session.data.user.name}<small>{current.role.toLowerCase()}</small></div></div></div></aside>
 <div className="app-main"><header className="app-topbar"><span>{current.name} <span className="breadcrumb">/</span> {team?'Team & access':chat?'Chat':sprints?'Sprints':'Overview'}</span><span className="privacy"><LockIcon/> Private workspace</span></header><div className="app-content"><div className="page-heading"><div><p className="eyebrow">{team?'THE PEOPLE BEHIND THE IDEAS':'MAKE ROOM FOR WHAT’S NEXT'}</p><h1>{team?'Better, together.':chat?'Your team, connected.':sprints?'A clear rhythm for your team.':'Welcome to '+current.name+'.'}</h1><p>{team?'Your teammates, their roles, and the invitations that bring them here.':chat?'Catch up on team channels and private messages.':sprints?'Plan and track delivery across your team’s projects.':'Your team’s home base. Start by bringing everyone into the same space.'}</p></div>{manage&&<button className="button" onClick={()=>{setModal(true);setNewLink('');setError('');}}><Plus size={18}/>Invite teammates</button>}</div>
 {error&&!modal&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
 {chat&&<ChatPanel workspaceId={w} write={current.role!=='VIEWER'}/>}
 {sprints&&<SprintHub workspaceId={w}/>}
 {!team&&!chat&&!sprints&&<Hackathons workspaceId={w} manage={manage}/> }
 {!team&&!chat&&!sprints&&<><div className="overview-grid"><section className="welcome-panel"><div><span className="icon-tile"><Users/></span><h2>Good work starts<br/>with your people.</h2><p>Invite your teammates, set their roles, and make this space your own.</p><Link className="button light" to={'/w/'+w+'/settings/members'}>Meet your team <ArrowUpRight size={17}/></Link></div><TeamSculpture/></section><section className="summary-panel"><p className="muted">WORKSPACE MEMBERS</p><strong className="big-count">{current.memberCount.toString().padStart(2,'0')}</strong><p>{current.memberCount===1?'Every great team starts with someone.':'Real people. A shared beginning.'}</p><div className="line"/><p className="muted">YOUR ROLE</p><span className="role-pill">{current.role.toLowerCase()}</span></section></div></>}
 {!chat&&!sprints&&<section className="section-panel"><div className="panel-heading"><div><h2>Team members <span className="count">{current.memberCount}</span></h2><p>Everyone with access to this workspace.</p></div><span className="muted small-text">Verified accounts only</span></div>{members.isLoading?<Loading/>:members.isError?<Notice error>{errorText(members.error)}</Notice>:<div className="table-scroll"><table><thead><tr><th>Member</th><th>Role</th><th>Joined</th>{manage&&<th className="right">Manage access</th>}</tr></thead><tbody>{rows(members).map(m=><tr key={m.id}><td><div className="member-cell"><span className="member-avatar">{m.user.name[0].toUpperCase()}</span><div><strong>{m.user.name}{m.userId===session.data!.user.id&&<small className="you">you</small>}</strong><small>{m.user.email}</small></div></div></td><td><span className={'role-pill '+m.role.toLowerCase()}>{m.role.toLowerCase()}</span></td><td className="muted">{new Date(m.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</td>{manage&&<td className="right"><div className="row-actions">{mayChange(current.role,m.role)&&<><select aria-label={'Change role for '+m.user.name} value={m.role} disabled={busy} onChange={e=>void mutate('/workspaces/'+w+'/members/'+m.userId,'PATCH',{role:e.target.value,expectedVersion:m.version})}>{current.role==='OWNER'&&<option>ADMIN</option>}<option>MEMBER</option><option>VIEWER</option></select><button className="danger-link" disabled={busy} onClick={()=>{if(confirm('Remove '+m.user.name+' from this workspace?'))void mutate('/workspaces/'+w+'/members/'+m.userId,'DELETE',{expectedVersion:m.version});}}>Remove</button></>}{current.role==='OWNER'&&m.userId!==session.data!.user.id&&<button className="link-button" disabled={busy} onClick={()=>{if(confirm('Transfer ownership to '+m.user.name+'? You will become an admin.'))void mutate('/workspaces/'+w+'/ownership-transfer','POST',{targetUserId:m.userId,expectedVersion:current.version});}}>Make owner</button>}</div></td>}</tr>)}</tbody></table></div>}<More query={members}/></section>}
 {team&&manage&&<>
 <section className="section-panel"><div className="panel-heading"><div><h2>Invitations</h2><p>Email-bound invitations and their actual delivery status.</p></div><Mail className="muted"/></div>{invitations.isError?<Notice error>{errorText(invitations.error)}</Notice>:rows(invitations).length?<div className="table-scroll"><table><thead><tr><th>Email</th><th>Role</th><th>Invitation</th><th>Delivery</th><th>Actions</th></tr></thead><tbody>{rows(invitations).map(i=><tr key={i.id}><td>{i.email}</td><td>{i.role.toLowerCase()}</td><td><span className="status-pill">{i.state.toLowerCase()}</span></td><td>{(i.deliveries[0]?.state??'unavailable').toLowerCase().replaceAll('_',' ')}</td><td>{!['ACCEPTED','REVOKED'].includes(i.state)&&<div className="row-actions"><button className="link-button" disabled={busy||!caps.data?.data.email} onClick={()=>void mutate('/workspaces/'+w+'/invitations/'+i.id+'/resend','POST')}>Resend</button><button className="danger-link" disabled={busy} onClick={()=>void mutate('/workspaces/'+w+'/invitations/'+i.id,'DELETE')}>Revoke</button></div>}</td></tr>)}</tbody></table></div>:<Empty title="No invitations yet.">Invite your teammates by email. Each invitation can only be accepted by its matching verified account.</Empty>}<More query={invitations}/></section>
 <section className="section-panel"><div className="panel-heading"><div><h2>Join links</h2><p>Anyone with a valid link can join as a member, subject to your approval policy.</p></div><Link2 className="muted"/></div>{links.isError?<Notice error>{errorText(links.error)}</Notice>:rows(links).length?rows(links).map(l=><div className="link-row" key={l.id}><span className="icon-tile small-avatar"><Link2 size={18}/></span><div><strong>{l.requiresApproval?'Approval required':'Direct join'} <span className="status-pill">{l.revokedAt?'revoked':new Date(l.expiresAt)<new Date()?'expired':l.uses>=l.maxUses?'full':'active'}</span></strong><small>{l.uses} / {l.maxUses} uses · Expires {new Date(l.expiresAt).toLocaleDateString()}</small></div>{!l.revokedAt&&<button className="danger-link" disabled={busy} onClick={()=>void mutate('/workspaces/'+w+'/join-links/'+l.id,'DELETE')}>Revoke</button>}</div>):<Empty title="Keep joining simple.">Create a time-limited link with a usage limit. Links are only shown once when created.</Empty>}<More query={links}/></section>
 <section className="section-panel"><div className="panel-heading"><div><h2>Join requests</h2><p>Review who gets a place in your workspace.</p></div><ShieldCheck className="muted"/></div>{requests.isError?<Notice error>{errorText(requests.error)}</Notice>:rows(requests).length?rows(requests).map(r=><div className="link-row" key={r.id}><div><strong>{r.user.name}</strong><small>{r.user.email}</small></div><div className="row-actions">{(['APPROVED','REJECTED'] as const).map(decision=><button key={decision} disabled={busy} className={decision==='APPROVED'?'button small':'link-button'} onClick={()=>void mutate('/workspaces/'+w+'/join-requests/'+r.id+'/decision','POST',{decision,expectedVersion:r.version})}>{decision==='APPROVED'?'Approve':'Decline'}</button>)}</div></div>):<p className="muted">No pending requests. You’re all caught up.</p>}<More query={requests}/></section>
 </>}
 <footer className="app-footer"><span>Built for the way teams begin.</span><span>DevCollab</span></footer>
 </div></div>
 {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onKeyDown={e=>{if(e.key==='Escape')setModal(false);}}><button autoFocus className="close-button" aria-label="Close invitation dialog" onClick={()=>setModal(false)}><X/></button><span className="icon-tile"><Users/></span><h2 id="invite-title">Bring your people in.</h2><p className="muted">A shared space starts with an invitation.</p><div className="tabs"><button className={tab==='email'?'selected':''} onClick={()=>setTab('email')}><Mail size={16}/>By email</button><button className={tab==='link'?'selected':''} onClick={()=>setTab('link')}><Link2 size={16}/>Join link</button></div>{error&&<Notice error>{error}</Notice>}<form onSubmit={invite}>
 {tab==='email'?<>{!caps.data?.data.email&&<Notice>Email delivery is unavailable until a provider is configured.</Notice>}{caps.data?.data.emailMode==='local-preview'&&<Notice>Development inbox only: these invitations will not reach real email inboxes. Use a join link for independent local sessions, or configure a mail provider.</Notice>}<Field label="Teammate email addresses"><input name="emails" type="email" multiple required placeholder="alex@example.com, sam@example.com"/></Field><p className="helper">Separate addresses with commas. Press Enter to send. Up to 20 invitations at a time.</p><Field label="Workspace role"><select name="role" defaultValue="MEMBER"><option>MEMBER</option><option>VIEWER</option>{current.role==='OWNER'&&<option>ADMIN</option>}</select></Field><button className="button full" disabled={busy||!caps.data?.data.email}>{busy?'Waiting for confirmation...':'Send invitations'}<ArrowRight size={17}/></button></>:<><Notice>Anyone holding this link can join as a member. Use approval if you want to review each person.</Notice><div className="form-row"><Field label="Expires in"><select name="days"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></Field><Field label="Maximum uses"><input name="maxUses" type="number" min={1} max={100} defaultValue={4} required/></Field></div><label className="checkbox"><input name="approval" type="checkbox"/>Require approval before joining</label><button className="button full" disabled={busy}>{busy?'Creating…':'Create join link'}<Link2 size={17}/></button>{newLink&&<div className="generated-link"><Field label="Copy this link now; it will not be shown again"><input readOnly value={newLink} onFocus={e=>e.target.select()}/></Field><button type="button" className="button secondary full" onClick={async()=>{try{await navigator.clipboard.writeText(newLink);setNotice('Join link copied.');}catch{setError('Select and copy the link manually.');}}}><Copy size={16}/>Copy link</button></div>}</>}
 </form></section></div>}
 </main>;
}
function LockIcon(){return <ShieldCheck size={14}/>;}



