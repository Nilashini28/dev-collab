import { useRef, useState } from 'react';
import { Link } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowRight, ArrowUpRight, Users, LockKeyhole, Check, Sparkles, GitBranch, MessageCircle, Workflow, Circle, MoreHorizontal } from 'lucide-react';
import { Brand, LogoMark } from '../components';
gsap.registerPlugin(ScrollTrigger,useGSAP);
export function Landing(){
 const root=useRef<HTMLElement>(null);
 const stage=useRef<HTMLDivElement>(null);
 const [scene,setScene]=useState(0);
 const scenes=[['Find your people.','Bring your team together.'],['Connect your ideas.','Make something that matters.'],['Make it happen.','One shared beginning.']];
 function tilt(event:React.PointerEvent<HTMLDivElement>){
   if(matchMedia('(prefers-reduced-motion: reduce)').matches||event.pointerType==='touch')return;
   const rect=event.currentTarget.getBoundingClientRect();
   gsap.to(stage.current,{rotateY:((event.clientX-rect.left)/rect.width-.5)*24,rotateX:-((event.clientY-rect.top)/rect.height-.5)*18,duration:.5,overwrite:true});
 }
 useGSAP(()=>{
   const mm=gsap.matchMedia();
   mm.add('(prefers-reduced-motion: no-preference)',()=>{
     gsap.from('.hero-copy > *',{y:24,opacity:0,stagger:.09,duration:.7,ease:'power2.out'});
     gsap.fromTo('.orbit-art',{scale:.8,opacity:.5},{scale:1,opacity:1,scrollTrigger:{trigger:'.hero',start:'top center',end:'bottom center',scrub:1}});
     gsap.utils.toArray<HTMLElement>('.bento article').forEach((card,i)=>gsap.from(card,{y:38,opacity:0,duration:.7,delay:i*.09,ease:'power3.out',scrollTrigger:{trigger:card,start:'top 92%',once:true}}));
     ScrollTrigger.create({trigger:'.walkthrough',start:'top 25%',end:'bottom 70%',pin:'.walk-title',pinSpacing:false});
   });
   return ()=>mm.revert();
 },{scope:root});
 return <main ref={root} className="landing overflow-x-hidden w-full max-w-full">
  <nav className="public-nav"><Brand/><div><a href="#how">How it works</a><Link to="/login">Sign in</Link><Link className="button small" to="/register">Create your workspace <ArrowUpRight size={16}/></Link></div></nav>
  <section className="hero"><div className="hero-copy"><p className="eyebrow">GOOD IDEAS NEED A GREAT TEAM.</p><h1 className="max-w-5xl">Big ideas.<br/>One shared space<span>.</span></h1><p className="lead">Bring your hackathon team together. A private place to start, connect, and build something that matters.</p><div className="actions"><Link className="button" to="/register">Build with your team <ArrowRight size={18}/></Link><Link className="text-link" to="/login">Already a member? Sign in</Link></div><p className="quiet"><LockKeyhole size={14}/> Private workspaces. Real teammates. Your next beginning.</p></div>
   <div className="orbit-art interactive-scene workspace-preview" onPointerMove={tilt} onPointerLeave={()=>gsap.to(stage.current,{rotateX:0,rotateY:0,duration:.8})}>
    <div ref={stage} className={'orbit-stage preview-stage scene-'+scene}>
     <div className="preview-back back-two"><GitBranch size={14}/><span>Code connected. Context shared.</span><span className="preview-dot"/></div>
     <div className="preview-back back-one"><Workflow size={14}/><span>A plan everyone can build on.</span><MoreHorizontal size={16}/></div>
     <div className="preview-sheet"><header><span className="preview-brand"><LogoMark/>devcollab.</span><span className="preview-tag">Workspace preview</span></header><div className="preview-body"><aside><span className="preview-nav active"><Circle size={12}/> Overview</span><span className="preview-nav"><Users size={12}/> Team</span><span className="preview-nav"><GitBranch size={12}/> Contributions</span><span className="preview-nav"><MessageCircle size={12}/> Chat</span><div className="preview-avatar-row"><i>AL</i><i>JD</i><i>MK</i><span>+ you</span></div></aside><div className="preview-content"><p>WEEKEND BUILDERS</p><h3>{['Your people, in sync.','From idea to done.','A shared blueprint.'][scene]}</h3><div className="preview-stats"><div><small>Team members</small><strong>04</strong></div><div><small>Next milestone</small><strong>Demo day</strong></div></div><div className="preview-list">{(scene===0?['Invite your teammates','Give everyone a place','Start the conversation']:scene===1?['Define the core feature','Build the first prototype','Review it together']:['Map the architecture','Review the workflow','Publish to team wiki']).map((label,i)=><div key={label}><span className={i===0?'preview-check done':'preview-check'}>{i===0&&<Check size={11}/>}</span><span>{label}</span><small>{i===0?'Done':i===1?'In progress':'Up next'}</small></div>)}</div></div></div><footer><span className="preview-dot"/>A little structure. A lot of possibility.<ArrowUpRight size={14}/></footer></div>
    </div><div className="scene-controls" aria-label="Explore the team illustration">{['Gather','Connect','Create'].map((label,index)=><button key={label} aria-pressed={scene===index} onClick={()=>setScene(index)}>{label}</button>)}</div>
   </div>
  </section>
  <div className="type-marquee" aria-hidden="true"><div>YOUR PEOPLE / YOUR IDEAS / YOUR SPACE / YOUR PEOPLE / YOUR IDEAS / YOUR SPACE / </div></div>
  <section id="how" className="feature-section"><div className="section-intro"><p className="eyebrow">START TOGETHER</p><h2>Less setup.<br/>More possibility.</h2><p>Get your people into one place, with access that stays in your hands.</p></div><div className="bento grid-flow-dense">
   <article><Users/><h3>Make room for your team.</h3><p>Create a named workspace. It starts with you, then grows with the people you invite.</p></article>
   <article className="violet-card"><ArrowUpRight/><h3>One invitation.<br/>A shared beginning.</h3><p>Invite by email or create a limited join link. Add an approval step when you want more control.</p></article>
   <article><LockKeyhole/><h3>The right access.<br/>For every person.</h3><p>Assign clear roles. Keep your workspace private and your membership list up to date.</p></article>
  </div></section>
  <section className="walkthrough"><div className="walk-title"><p className="eyebrow">A SIMPLE FIRST STEP</p><h2>Your team starts<br/><span className="inline-art" aria-hidden="true"/> right here.</h2></div><div className="steps">
   <details open><summary>Create your account <ArrowUpRight size={18}/></summary><p>Use your email with a new DevCollab password, or Google when enabled. Verify your email to access team workspaces.</p></details>
   <details><summary>Name your workspace <ArrowUpRight size={18}/></summary><p>Choose a name your team recognizes. You become its owner and can manage who joins.</p></details>
   <details><summary>Bring everyone in <ArrowUpRight size={18}/></summary><p>Send individual invitations or share an expiring join link. Each teammate joins with their own verified account.</p></details>
  </div></section>
  <footer className="landing-footer"><div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Make something.<br/>Together.</h2></div><Link className="button light" to="/register">Create your workspace <ArrowUpRight/></Link><div className="footer-bottom"><Brand/><span>A private home for student teams.</span></div></footer>
 </main>;
}
