import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:600},reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/');
 await page.evaluate(async()=>{const path='/test/diagram-fixture.tsx';const module=await import(/* @vite-ignore */ path);module.mount();});
 for(const label of ['Client','API','Database'])await page.locator('#diagram-check svg text').filter({hasText:label}).waitFor({state:'visible'});
 assert.equal(await page.locator('#diagram-check foreignObject').count(),0);assert.deepEqual(errors,[]);
 await page.locator('#diagram-check').screenshot({path:'test-results/diagram-labels.png'});
 console.log('PASS Actual shared Diagram component: Client, API and Database labels are visible as safe SVG text; no foreignObject or uncaught errors.');
}finally{await browser.close();}
