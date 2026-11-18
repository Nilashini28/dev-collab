import {useEffect} from 'react';
import {useLocation} from 'react-router';
import gsap from 'gsap';
// Animate navigation, never query refreshes or incoming chat messages.
export function PageMotion(){
 const location=useLocation();
 useEffect(()=>{
  const media=gsap.matchMedia();let frame=0;let observer:MutationObserver|undefined;
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   let animated=false;let tween:gsap.core.Tween|undefined;let surface:Element|null=null;
   const reveal=()=>{
    if(animated)return;
    surface=document.querySelector('.app-content, .auth-form, .chooser-content');if(!surface)return;
    animated=true;observer?.disconnect();
    tween=gsap.fromTo(surface,{y:12,opacity:.55},{y:0,opacity:1,duration:.48,ease:'power3.out',clearProps:'transform,opacity'});
   };
   frame=requestAnimationFrame(reveal);observer=new MutationObserver(reveal);observer.observe(document.getElementById('root')!,{subtree:true,childList:true});
   return()=>{cancelAnimationFrame(frame);observer?.disconnect();tween?.kill();if(surface)gsap.set(surface,{clearProps:'transform,opacity'});};
  });
  return()=>{media.revert();cancelAnimationFrame(frame);observer?.disconnect();};
 },[location.pathname,location.search]);
 return null;
}
