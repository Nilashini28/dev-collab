export type ContextSource={sourceId:string;documentId:string;title:string;section:string;text:string;chunkId?:string;version?:number};
export type Citation={sourceId:string;quote:string};
export type Requirement={documentId:string;section:string;quote:string};
export function checkEvidence(sources:ContextSource[],citations:Citation[],requirements:Requirement[],answer=''){
 const refs:Array<Omit<ContextSource,'text'>&{quote:string}>=[];let valid=0;
 for(const citation of [...citations,...requirements]){
  const source='sourceId' in citation?sources.find(s=>s.sourceId===citation.sourceId):sources.find(s=>s.documentId===citation.documentId&&s.section===citation.section&&s.text.includes(citation.quote));
  if(source&&citation.quote.trim()&&source.text.includes(citation.quote)){
   valid++;const {text,...metadata}=source;if(!refs.some(r=>r.sourceId===source.sourceId&&r.quote===citation.quote))refs.push({...metadata,quote:citation.quote});
  }
 }
 const total=citations.length+requirements.length;
 const markers=[...answer.matchAll(/\[S(\d+)\]/g)].map(m=>'S'+m[1]);
 const markersValid=markers.every(id=>refs.some(r=>r.sourceId===id));
 return {references:refs,total,valid,validity:total?valid/total:null,accepted:valid===total&&markersValid,markersValid};
}
export const providerTokenCount=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647?value:undefined;
