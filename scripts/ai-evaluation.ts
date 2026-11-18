import 'dotenv/config';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {aiResult,safeDiagram} from '../apps/api/src/ai-contracts';
import {checkEvidence,providerTokenCount} from '../apps/api/src/ai-evidence';
import {requestAssistant} from '../apps/api/src/ai-provider';
const live=process.argv.includes('--live');
if(live&&(!process.env.OPENAI_API_KEY||!process.env.LLM_MODEL))throw Error('Live evaluation requires server OPENAI_API_KEY and LLM_MODEL; fixture evaluation needs no credentials.');
const cases=JSON.parse(await readFile('tests/fixtures/ai-evaluation.json','utf8'));const results:any[]=[];
for(const item of cases){const started=performance.now();let inputTokens:number|null=null,outputTokens:number|null=null;
 try{
  let result:any={...item.fixture,requirements:[],recommendations:[],tasks:[],wiki:{title:'Evaluation draft',content:'',mermaid:''}};
  if(live){const response=await requestAssistant(process.env.LLM_MODEL!,'[ASK] '+item.prompt,{sources:item.sources,coverage:{synthetic:true},previous:[]});if(!response.ok)throw Error('PROVIDER_HTTP_'+response.status);const raw:any=await response.json();inputTokens=providerTokenCount(raw.usage?.input_tokens)??null;outputTokens=providerTokenCount(raw.usage?.output_tokens)??null;if(raw.status!=='completed')throw Error('INCOMPLETE_RESPONSE');const text=raw.output?.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');result=JSON.parse(text);}
  result=aiResult.parse(result);const evidence=checkEvidence(item.sources,result.citations,result.requirements,result.answer);
  const expectedAccepted=live?true:item.expected.accepted;
  const terms=live?(item.liveContains??item.expected.contains):item.expected.contains;
  const contains=terms.every((term:string)=>result.answer.toLowerCase().includes(term.toLowerCase()));
  const excludes=item.expected.excludes.every((term:string)=>!result.answer.includes(term));
  const pass=evidence.accepted===expectedAccepted&&safeDiagram(result.wiki.mermaid)&&(!expectedAccepted||(contains&&excludes));
  results.push({id:item.id,category:item.category,pass,accepted:evidence.accepted,citationsValid:evidence.valid,citationTotal:evidence.total,citationValidity:evidence.validity,latencyMs:performance.now()-started,inputTokens,outputTokens,answer:result.answer,keywordChecks:{contains,excludes}});
 }catch(error){results.push({id:item.id,pass:false,error:error instanceof Error?error.message:'EVALUATION_FAILED',latencyMs:performance.now()-started,inputTokens,outputTokens});}
}
const times=results.map(r=>r.latencyMs).sort((a,b)=>a-b),report={mode:live?'live-provider':'fixture-contract',notice:live?'Synthetic-case keyword checks need human review; not proof of general answer accuracy or tenant isolation.':'Deterministic fixtures test citation validation and expected behavior. Latency is fixture validation time, not model latency; token usage is unavailable.',generatedAt:new Date().toISOString(),model:live?process.env.LLM_MODEL:null,passed:results.filter(r=>r.pass).length,total:results.length,medianLatencyMs:times[Math.floor(times.length/2)],p95LatencyMs:times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)],inputTokens:live&&results.some(r=>r.inputTokens!==null)?results.reduce((n,r)=>n+(r.inputTokens??0),0):null,outputTokens:live&&results.some(r=>r.outputTokens!==null)?results.reduce((n,r)=>n+(r.outputTokens??0),0):null,usageReportedCases:results.filter(r=>r.inputTokens!==null&&r.outputTokens!==null).length,results};
await mkdir('test-results',{recursive:true});await writeFile('test-results/ai-evaluation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
