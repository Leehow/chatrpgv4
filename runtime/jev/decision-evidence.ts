/** Bounded public decision diagnostics; credentials and transport options are never part of a DecisionBatch. */
import {createHash} from 'node:crypto';
import type {DecisionBatch} from './contracts.ts';
import {packDecisionBatch} from './question-packing.ts';
export function decisionEvidence(batch:DecisionBatch,answers:unknown){
 const content={request:packDecisionBatch(batch).request,answers},raw=JSON.stringify(content),bytes=Buffer.byteLength(raw);
 return {batch_id:batch.id,sha256:createHash('sha256').update(raw).digest('hex'),bytes,
  ...(bytes<=32768?content:{omitted:true,reason:'decision_evidence_byte_limit'})};
}
