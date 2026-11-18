import {useEffect,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {io} from 'socket.io-client';
import {Send,MessageCircle,Users,Plus,GitBranch,ExternalLink,RefreshCw,GitPullRequest,GitCommitHorizontal} from 'lucide-react';
import {api,authClient,queryClient,errorText} from '../api';
import {Field,Notice,Empty,Loading} from '../components';
type Row=Record<string,any>;
export function ChatPanel({workspaceId:w,projectId:p,write}:{workspaceId:string;projectId?:string;write:boolean}){
 const session=authClient.useSession();const [conversation,setConversation]=useState(''),[error,setError]=useState(''),[body,setBody]=useState(''),[online,setOnline]=useState(false);
 const [pending,setPending]=useState<Array<{id:string;body:string;state:'sending'|'failed'}>>([]);
 const end=useRef<HTMLDivElement>(null);
 const conversations=useInfiniteQuery({queryKey:['conversations',w],initialPageParam:'',queryFn:({pageParam})=>api('/workspaces/'+w+'/conversations'+(pageParam?'?cursor='+pageParam:'')),getNextPageParam:r=>r.nextCursor??undefined,refetchInterval:5000});
 const members=useQuery({queryKey:['chat-members',w],queryFn:()=>api('/workspaces/'+w+'/members?limit=100')});
 const list:Row[]=conversations.data?.pages.flatMap(page=>page.items)??[];
 const current=list.find(c=>c.id===conversation);
 const messages=useInfiniteQuery({queryKey:['messages',conversation],initialPageParam:0,enabled:!!conversation,queryFn:({pageParam})=>api('/conversations/'+conversation+'/messages'+(pageParam?'?before='+pageParam:'')),getNextPageParam:result=>result.hasMore?result.items[0]?.sequence:undefined,refetchInterval:5000});
 const rows:Row[]=[...new Map<string,Row>((messages.data?.pages.flatMap(page=>page.items)??[]).map((m:Row)=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
 useEffect(()=>{if(!conversation&&list.length)setConversation(list.find(c=>c.unread>0)?.id??list.find(c=>c.projectId===p)?.id??list[0].id);},[list.length,p,conversation]);
 useEffect(()=>{
  if(!conversation)return;
  const socket=io({transports:['websocket'],withCredentials:true});const seen=new Set<string>();
  socket.on('connect',()=>{socket.emit('subscribe',conversation,(result:{ok:boolean})=>{setOnline(result.ok);if(!result.ok)setError('Conversation access is unavailable.');});void queryClient.invalidateQueries({queryKey:['messages',conversation]});});
  socket.on('disconnect',()=>setOnline(false));socket.on('connect_error',()=>setOnline(false));
  socket.on('message.created',(event:{id:string;conversationId:string})=>{if(seen.has(event.id))return;seen.add(event.id);if(seen.size>500)seen.clear();if(event.conversationId===conversation)void queryClient.invalidateQueries({queryKey:['messages',conversation]});});
  const disconnect=()=>{socket.disconnect();setOnline(false);};window.addEventListener('devcollab:disconnect',disconnect);
  return ()=>{window.removeEventListener('devcollab:disconnect',disconnect);socket.disconnect();};
 },[conversation]);
 const latest=rows.at(-1)?.sequence;
 useEffect(()=>{
  const markRead=()=>{if(!conversation||!latest||document.visibilityState!=='visible')return;
   void api('/conversations/'+conversation+'/read','POST',{sequence:latest}).then(()=>Promise.all([queryClient.invalidateQueries({queryKey:['chat-summary',w]}),queryClient.invalidateQueries({queryKey:['conversations',w]})])).catch(e=>setError(errorText(e)));
  };markRead();document.addEventListener('visibilitychange',markRead);window.addEventListener('focus',markRead);
  end.current?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
  return()=>{document.removeEventListener('visibilitychange',markRead);window.removeEventListener('focus',markRead);};
 },[conversation,latest,w]);
 async function open(kind:string,peerId?:string){
  setError('');try{const r=await api('/workspaces/'+w+'/conversations','POST',{kind,projectId:kind==='PROJECT'?p:undefined,peerId});await queryClient.invalidateQueries({queryKey:['conversations',w]});setConversation(r.data.id);}catch(e){setError(errorText(e));}
 }
 async function send(text:string,id:string=crypto.randomUUID()){
  if(!text.trim()||!conversation)return;setError('');
  setPending(items=>[...items.filter(item=>item.id!==id),{id,body:text,state:'sending'}]);
  try{await api('/conversations/'+conversation+'/messages','POST',{body:text,clientMessageId:id});setPending(items=>items.filter(item=>item.id!==id));await queryClient.invalidateQueries({queryKey:['messages',conversation]});}
  catch(e){setPending(items=>items.map(item=>item.id===id?{...item,state:'failed'}:item));setError(errorText(e));}
 }
 function name(c:Row){return c.kind==='DM'?c.participants.find((x:Row)=>x.userId!==session.data?.user.id)?.user.name??'Direct message':c.name;}
 return <section className="chat-layout"><aside className="chat-list"><div className="panel-heading"><h2>Conversations</h2><MessageCircle size={18}/></div>{conversations.isError&&<Notice error>{errorText(conversations.error)}</Notice>}{list.map(c=><button key={c.id} className={conversation===c.id?'selected':''} onClick={()=>{setConversation(c.id);setPending([]);setError('');}}><span>{c.kind==='DM'?<MessageCircle size={16}/>:<Users size={16}/>}</span><strong>{name(c)}</strong>{c.unread>0&&<small>{c.unread}</small>}</button>)}{conversations.hasNextPage&&<button onClick={()=>conversations.fetchNextPage()}>More conversations</button>}{write&&<><div className="chat-list-actions"><button className="link-button" onClick={()=>open('GROUP')}>Open team conversation</button>{p&&<button className="link-button" onClick={()=>open('PROJECT')}>Open project conversation</button>}</div><Field label="Start a direct message"><select value="" onChange={e=>{if(e.target.value)void open('DM',e.target.value);}}><option value="">Choose a teammate…</option>{members.data?.items.filter((m:Row)=>m.userId!==session.data?.user.id).map((m:Row)=><option key={m.id} value={m.userId}>{m.user.name}</option>)}</select></Field></>}</aside><div className="chat-main"><header><div><h2>{current?name(current):'Your team, one conversation away.'}</h2><p>{current?.kind==='DM'?'Private to the two participants.': 'A shared conversation for your team.'}</p></div><span className={'connection-state '+(online?'online':'')}>{online?'Live':'Periodic sync'}</span></header>{error&&<Notice error>{error}</Notice>}<div className="message-scroll">{!conversation?<Empty title="Start a conversation.">Choose a team channel or send a direct message to a teammate.</Empty>:messages.isLoading?<Loading/>:messages.isError?<Notice error>{errorText(messages.error)}</Notice>:<>{messages.hasNextPage&&<button className="link-button history-button" onClick={()=>messages.fetchNextPage()}>Load earlier messages</button>}{rows.map(m=><article className={'message '+(m.senderId===session.data?.user.id?'mine':'')} key={m.id}><div><strong>{m.authorName}</strong><time>{new Date(m.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time></div><p>{m.body}</p></article>)}{pending.map(m=><article className="message mine pending" key={m.id}><p>{m.body}</p><small>{m.state==='sending'?'Sending…':'Not sent. '}{m.state==='failed'&&<button className="link-button" onClick={()=>send(m.body,m.id)}>Retry</button>}</small></article>)}<div ref={end}/></>}</div><form className="message-compose" onSubmit={e=>{e.preventDefault();if(body.trim()){void send(body);setBody('');}}}><textarea aria-label="Message" rows={2} value={body} maxLength={6000} disabled={!write||!conversation} placeholder={write?'Share a thought, ask a question…':'You have read-only access.'} onChange={e=>setBody(e.target.value)}/><button className="button" aria-label="Send message" disabled={!write||!conversation||!body.trim()}><Send size={17}/></button></form></div></section>;
}
export {GitHubPanel} from './GitHubDashboard';
