/** Real Jev/PDF component comparison. No campaign, Keeper or gameplay evidence is produced. */
import {mkdir,writeFile,appendFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readVaultSecret} from '../single-loop-routing/vault.mjs';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {sourceInfo} from '../../extensions/module/source.ts';
import {visualFunnel,pdfVisualSheet} from '../../runtime/jev/visual-funnel.ts';

const pdf=resolve(process.argv[2]??'content/starters/the-haunting/source.pdf');
const question=process.argv[3]??'Printed maps or floor plans. Exclude ordinary paragraphs, tables, character sheets and decorative illustrations.';
const first=Number(process.argv[4]??1),lastArgument=process.argv[5];
const env={...process.env,EXT_JEV_APIKEY:readJevApiKey(process.env)??readVaultSecret('EXT_JEV_APIKEY')};
if(!readJevApiKey(env))throw new Error('The canonical Jev credential is unavailable; no requests were sent.');
const root=resolve('.coc/experiments');await mkdir(root,{recursive:true});
const dir=await mkdtemp(join(root,'jev-visual-funnel-20261014-'));
const info=await sourceInfo(pdf),last=Number(lastArgument??Math.min(info.page_count,first+16));
if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>info.page_count)throw new Error('Invalid physical page range');
const pages=Array.from({length:last-first+1},(_,index)=>first+index),events=[];
await writeFile(join(dir,'input.json'),JSON.stringify({pdf,question,pages,source_sha256:info.file_sha256,component_only:true},null,2));
const initial=await pdfVisualSheet(pdf,join(dir,'cache'),pages.slice(0,16),info.file_sha256,AbortSignal.timeout(30000));
await writeFile(join(dir,'input-sheet.jpg'),Buffer.from(initial.image.data_base64,'base64'));
const decision=createDecisionAdapter({env,maxConcurrency:4,trace:row=>events.push({kind:'transport',...row})});
const scope={owner:'component-visual-comparison',audience:'keeper'},readSet=[{kind:'source',resource:pdf,revision:info.file_sha256}];
let imageIndex=0;
function options(arm){return {pdf,cache:join(dir,'cache'),sourceSha:info.file_sha256,question,scope,readSet,decision,
  signal:AbortSignal.timeout(120000),boxes:true,record:row=>events.push({arm,...row}),
  retainSheet:async(sheet,stage)=>{const filename=`${arm}-${stage}-${imageIndex++}.jpg`;
    await writeFile(join(dir,filename),Buffer.from(sheet.image.data_base64,'base64'));
    await appendFile(join(dir,'sheets.jsonl'),JSON.stringify({arm,stage,file:filename,image_sha256:sheet.imageSha,tiles:sheet.tiles})+'\n');}};}
async function baseline(){const began=Date.now(),results=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,pages.length)},async()=>{while(cursor<pages.length){const page=pages[cursor++];
    results.push(await visualFunnel({...options('single-page'),pages:[page]}));}}));
  return {ms:Date.now()-began,leads:results.flatMap(row=>row.leads).sort((a,b)=>a.page-b.page),rejected:results.flatMap(row=>row.rejected).sort((a,b)=>a-b),
    partial:results.some(row=>row.partial),calls:results.reduce((n,row)=>n+row.calls,0),inputTokens:results.reduce((n,row)=>n+row.inputTokens,0),costUsd:results.reduce((n,row)=>n+row.costUsd,0)};
}
try{
  // Alternate order between invocations to expose warm-cache/order effects; each arm uses the same rendering cache and concurrency.
  const order=process.env.JEV_COMPARISON_ORDER==='funnel-first'?['funnel','baseline']:['baseline','funnel'],result={order};
  for(const arm of order){result[arm]=arm==='baseline'?await baseline():await visualFunnel({...options('funnel'),pages});
    console.log(JSON.stringify({arm,ms:result[arm].ms,calls:result[arm].calls,inputTokens:result[arm].inputTokens,costUsd:result[arm].costUsd,
      leads:result[arm].leads.map(row=>({page:row.page,score:row.score,box:row.box})),partial:result[arm].partial}));}
  result.agreement={baselinePages:result.baseline.leads.map(row=>row.page),funnelPages:result.funnel.leads.map(row=>row.page)};
  await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));
}finally{await writeFile(join(dir,'events.jsonl'),events.map(row=>JSON.stringify(row)).join('\n')+'\n');console.log(JSON.stringify({evidence:dir}));}
