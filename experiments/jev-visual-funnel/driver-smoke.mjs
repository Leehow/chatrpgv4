/** Real source-driver projection check, before any author inference or publication. */
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readVaultSecret} from '../single-loop-routing/vault.mjs';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import {createSourceReaderDriver} from '../../runtime/jev/source-reader-driver.ts';
import {sourceInfo} from '../../extensions/module/source.ts';

const env={...process.env,EXT_JEV_APIKEY:readJevApiKey(process.env)??readVaultSecret('EXT_JEV_APIKEY')};
if(!readJevApiKey(env))throw new Error('Canonical Jev credential unavailable');
const pdf=resolve('content/starters/the-haunting/source.pdf'),info=await sourceInfo(pdf);
await mkdir('.coc/experiments',{recursive:true});const cwd=await mkdtemp(resolve('.coc/experiments/jev-visual-driver-20261014-'));
await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'detail',module_id:'component-source',visual_asset:{page:7},
  source:{page_count:info.page_count},question:'Prepare the printed map.'})+'\n');
const driver=await createSourceReaderDriver({cwd,env,source:{pdf,cache:join(cwd,'cache'),file_sha256:info.file_sha256}});
const {ports}=await driver.prepare({runId:'component-real-jev',inputRevision:'1',rawInput:'Project the original source',session:{}});
const results=[];
for(const operation of ['source.catalog','source.project'])results.push(await ports.operations.execute({origin:'policy',operation},{signal:AbortSignal.timeout(30000)}));
if(results.some(result=>result.status!=='ok'))throw new Error('Source projection failed');
const messages=ports.projection.project({}),packet=JSON.parse(messages[0].content[0].text);
const events=(await readFile(join(cwd,'source-driver.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const models=[...new Set(events.filter(row=>row.kind==='visual_funnel').map(row=>row.model))];
const result={component_only:true,models,advisory_visual_leads:packet.advisory_visual_leads,original_pages:messages[0].details.pages,
  images:messages[0].content.filter(row=>row.type==='image').length,author_inference:false,publication:false};
await writeFile(join(cwd,'projection.json'),JSON.stringify(result,null,2));
if(models.join(',')!=='jev-1.14.0'||result.images!==1||!result.advisory_visual_leads.some(row=>row.box))throw new Error('Actual visual hints or original page missing');
console.log(JSON.stringify({evidence:cwd,...result}));
