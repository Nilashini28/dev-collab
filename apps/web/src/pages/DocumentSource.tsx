import {useEffect,useRef} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,errorText} from '../api';
import {Loading,Notice} from '../components';
export function DocumentSource({projectId,documentId,sectionId}:{projectId:string;documentId:string;sectionId:string}){
 const query=useQuery({queryKey:['source-document',projectId,documentId],queryFn:()=>api('/projects/'+projectId+'/documents/'+documentId)});
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(query.data&&sectionId)ref.current?.querySelector('[data-section="'+CSS.escape(sectionId)+'"]')?.scrollIntoView({block:'center',behavior:'instant'});},[query.data,sectionId]);
 if(query.isLoading)return <Loading/>;if(query.isError)return <Notice error>{errorText(query.error)}</Notice>;const d=query.data?.data;if(!d)return null;
 return <section className="document-source-view" ref={ref}><div className="panel-heading"><div><h3>Source document: {d.title}</h3><p className="helper">Current document content. Compare it with the saved quotation in your answer.</p></div><a className="link-button" href="?tab=ai">Back to assistant</a></div>
 <nav className="source-section-nav" aria-label="Document sections">{d.chunks.map((c:any)=><a key={c.id} href={'#document-section-'+c.id}>{c.section}</a>)}</nav>
 {sectionId&&!d.chunks.some((c:any)=>c.id===sectionId)&&<Notice>The cited section is no longer available. The saved answer still contains its original quotation.</Notice>}
 {d.chunks.map((c:any)=><section id={'document-section-'+c.id} data-section={c.id} className={'source-section '+(sectionId===c.id?'source-section-selected':'')} key={c.id}><h4>{c.section}</h4><p className="source-text">{c.text}</p></section>)}</section>;
}
