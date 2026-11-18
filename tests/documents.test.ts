import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import JSZip from 'jszip';
function parse(buffer:Buffer,type:string):Promise<{code:number|null;text?:string}>{return new Promise((done,reject)=>{const child=spawn(process.execPath,[resolve('scripts/parse-document.mjs'),type],{windowsHide:true,stdio:['pipe','pipe','ignore']});let out='';child.stdout.on('data',c=>out+=c);child.on('error',reject);child.on('close',code=>done({code,...(out?JSON.parse(out):{})}));child.stdin.end(buffer);});}
it('extracts UTF-8 TXT and actual DOCX paragraphs in a separate process',async()=>{
 const text='A real requirements document with private teams.';
 expect(await parse(Buffer.from(text),'text/plain')).toEqual({code:0,text});
 const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
 expect(await parse(await zip.generateAsync({type:'nodebuffer'}),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toEqual({code:0,text});
},30000);
it('rejects malformed PDF and DOCX files',async()=>{
 expect((await parse(Buffer.from('%PDF-invalid'),'application/pdf')).code).toBe(2);
 expect((await parse(Buffer.from('not a zip'),'docx')).code).toBe(2);
},30000);
