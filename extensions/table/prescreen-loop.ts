/** Compatibility facade; the shared runtime owns the only evidence loop. */
import {digest} from './prescreen-types.ts';
import {object,type Row} from './context-policy.ts';
import {runEvidenceAgent,type EvidenceAgentOptions} from '../../runtime/jev/evidence-agent.ts';
import {supportRequest} from '../../runtime/jev/keeper-support-contract.ts';
export type {EvidenceOperation as PrescreenLoopOperation,EvidenceState as PrescreenLoopState,EvidenceStop as PrescreenLoopStop,EvidenceResult as PrescreenLoopResult} from '../../runtime/jev/evidence-agent.ts';
export type PrescreenLoopOptions=Omit<EvidenceAgentOptions,'request'>&{query:string};
export const runPrescreenLoop=(input:PrescreenLoopOptions)=>runEvidenceAgent({...input,request:supportRequest(input.query)});
/** Decode only the existing owner-projected relation schema; never infer entity names from prose. */
export function prescreenFollowTargets(materials:readonly Row[]):Array<{target:string;from:string;relation:string}> {
    const targets=new Map<string,{target:string;from:string;relation:string}>();
    for(const material of materials){
        if(!['module_source','campaign_adaptation'].includes(material.authority))continue;
        const read=object(material.read);
        if(read.tool==='lookup'&&read.kind==='module'&&typeof read.query==='string'&&read.query.trim()){
            const target=read.query,from=String(material.label??'');
            targets.set(digest([target,'source_detail']),{target,from,relation:'source_detail'});
        }
        let body=material.content;
        if(typeof body==='string')try{body=JSON.parse(body);}catch{continue;}
        const relations=object(body).relations,rows=Array.isArray(relations)?relations:Object.values(object(relations));
        for(const value of rows){const relation=object(value);
            for(const target of [relation.to,relation.from]){
                if(typeof target!=='string'||!target.trim()||target.length>512)continue;
                const from=String(material.label??''),kind=typeof relation.kind==='string'?relation.kind:'related';
                const key=digest([target,from,kind]);if(!targets.has(key))targets.set(key,{target,from,relation:kind});
            }
        }
    }
    return [...targets.values()];
}
