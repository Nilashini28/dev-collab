import {PDFParse} from 'pdf-parse';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
const parts=[];let size=0;
for await(const chunk of process.stdin){size+=chunk.length;if(size>5*1024*1024)process.exit(2);parts.push(chunk);}
const buffer=Buffer.concat(parts);let text='';
try{
 if(process.argv[2]==='application/pdf'){
  const parser=new PDFParse({data:new Uint8Array(buffer),isEvalSupported:false});
  try{const info=await parser.getInfo();if(info.total>100)throw Error('PAGE_LIMIT');text=(await parser.getText()).text;}finally{await parser.destroy();}
 }else if(process.argv[2]==='text/plain')text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
 else {
  const zip=await JSZip.loadAsync(buffer);const entry=zip.file('word/document.xml');if(!entry)throw Error('INVALID_DOCX');
  const xml=await entry.async('string');if(xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML_LIMIT');
  const document=new DOMParser().parseFromString(xml,'text/xml');
  const paragraphs=Array.from(document.getElementsByTagName('w:p'));
  text=paragraphs.map(p=>Array.from(p.getElementsByTagName('w:t')).map(t=>t.textContent).join('')).join('\n');
 }
 if(text.length>200000)throw Error('TEXT_LIMIT');
 process.stdout.write(JSON.stringify({text}));
}catch{process.exitCode=2;}
