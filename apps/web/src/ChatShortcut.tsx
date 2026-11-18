import {Link} from 'react-router';
import {useQuery} from '@tanstack/react-query';
import {MessageCircle} from 'lucide-react';
import {api} from './api';
export function useChatSummary(workspaceId:string,enabled=true){return useQuery({queryKey:['chat-summary',workspaceId],queryFn:()=>api('/workspaces/'+workspaceId+'/chat-summary'),enabled,refetchInterval:5000});}
export function ChatShortcut({workspaceId,active=false}:{workspaceId:string;active?:boolean}){
 const summary=useChatSummary(workspaceId);const count=summary.data?.data.unread??0;
 return <Link className={active?'active':''} to={'/w/'+workspaceId+'/chat'} aria-label={'Chat'+(count?', '+count+' unread messages':'')}><MessageCircle size={18}/><span>Chat</span>{summary.isError?<span className="nav-count" title="Unread count unavailable">!</span>:count>0&&<span className="nav-count chat-badge" aria-live="polite">{count>99?'99+':count}</span>}</Link>;
}
