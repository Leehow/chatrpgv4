/** Real Jev consent components against retained inputs; never generates gameplay or writes campaign state. */
import {readFileSync,writeFileSync,existsSync,statfsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {reviewAdmissionJevOnly,boundCashAuthority} from '../../extensions/kernel/admission.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readVaultSecret} from '../single-loop-routing/vault.mjs';

const [input,output]=process.argv.slice(2).map(path=>resolve(path));
if(!input||!output)throw Error('Usage: consent-time-probe.mjs CASES.json NEW_RESULT.json');
if(existsSync(output))throw Error('Preserve existing evidence');
const free=statfsSync(dirname(output));if(free.bavail*free.bsize<10*1024**3)throw Error('Test capacity admission');
const fixture=JSON.parse(readFileSync(input,'utf8'));
const env={...process.env,EXT_JEV_APIKEY:readVaultSecret('EXT_JEV_APIKEY')};
const adapter=createDecisionAdapter({env}),results=[];
for(const item of fixture.cases){
    let batch;
    const decision={decide:(value,lease)=>{batch=value;return adapter.decide(value,lease);}};
    const outcome=await reviewAdmissionJevOnly({campaign:'consent-time-component',context:item.context,
        proposal:item.proposal,decision,env,record:()=>{}});
    const verdict=outcome.ok?boundCashAuthority(item.proposal,item.context,outcome.verdict):undefined;
    const authorized=verdict?.verdict==='authorized';
    results.push({name:item.name,expected:item.expected??true,match:authorized===(item.expected??true),batch,outcome,verdict});
}
const record={kind:'component-diagnostic-only',at:new Date().toISOString(),source:input,
    limitations:fixture.limitations??'Constructed semantic contrasts, not gameplay or an archived wire request.',
    model:'jev-1.13.0',freeBefore:free.bavail*free.bsize,gameplayWrites:0,results};
writeFileSync(output,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({output,matched:results.filter(row=>row.match).length,total:results.length,
    results:results.map(row=>({name:row.name,expected:row.expected,match:row.match,verdict:row.verdict?.verdict,
        reason:row.outcome.reason,p:row.outcome.meta.line_admit_probabilities,ms:row.outcome.ms}))},null,2));
if(results.some(row=>!row.match))process.exitCode=1;
