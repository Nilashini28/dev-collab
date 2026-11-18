import {z} from 'zod';
export const aiAvailable=()=>!!(process.env.OPENAI_API_KEY&&process.env.LLM_MODEL);
export const suggestion=z.object({title:z.string().min(2).max(160),description:z.string().max(4000)});
export const aiResult=z.object({citations:z.array(z.object({sourceId:z.string().max(20),quote:z.string().min(1).max(1000)})).max(30).default([]),answer:z.string().max(12000),requirements:z.array(z.object({text:z.string().max(2000),documentId:z.string(),section:z.string(),quote:z.string().min(1).max(1000)})).max(30),recommendations:z.array(z.string().max(2000)).max(20),tasks:z.array(suggestion).max(20),wiki:z.object({title:z.string().min(2).max(160),content:z.string().max(20000),mermaid:z.string().max(5000)})});

export const safeDiagram=(source:string)=>!source||(/^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/.test(source.trim())&&!/%%\{|\bclick\s|<|href|https?:|javascript:|data:/i.test(source));

export const contextOptions=z.object({
 project:z.boolean().default(true),schedule:z.boolean().default(true),tasks:z.boolean().default(true),wiki:z.boolean().default(true),repository:z.boolean().default(true),history:z.boolean().default(true),
 taskIds:z.array(z.string().min(1).max(128)).max(30).optional(),wikiIds:z.array(z.string().min(1).max(128)).max(10).optional(),sectionIds:z.array(z.string().min(1).max(128)).max(50).optional()
}).strict();
