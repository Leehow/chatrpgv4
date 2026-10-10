/** Closed review outcomes; the reviewer owns the semantic impact judgment. */
import {REVIEW_VERDICTS} from './review-verdicts.ts';
export const MODULE_LOGIC_REVIEW='module-logic-v1';
export const MODULE_REVIEW_IMPACTS=['logic','presentation','parameter'] as const;
type Row=Record<string,any>;
export const moduleLogicReview=(packet:Row):boolean=>packet.review_policy===MODULE_LOGIC_REVIEW;
export const advisoryModuleFinding=(finding:unknown):boolean=>!!finding&&typeof finding==='object'&&
 ['presentation','parameter'].includes((finding as Row).impact);
/** The publication rule, shared with host repair and accepted-cache decisions. */
export function moduleReviewOutcome(finding:Row,packet:Row,flags:{asWritten:boolean;classification:boolean}):'supported'|'contested'|'refused'{
 if(finding?.verdict==='supported')return 'supported';
 if(flags.asWritten||!REVIEW_VERDICTS.includes(finding?.verdict))return 'refused';
 return (moduleLogicReview(packet)?advisoryModuleFinding(finding):flags.classification)?'contested':'refused';
}
/** Preserve declared fields while projecting the policy that actually judges them. */
export function reviewClassificationFields(fields:unknown,packet:Row):unknown{
 if(!moduleLogicReview(packet)||!fields||typeof fields!=='object'||Array.isArray(fields))return fields;
 return {...fields,law:'These are implementation classifications, not independent source evidence. Under module-logic-v1, presentation and valid parameter differences are advisory; missing or contradictory logic refuses, even at a classification pointer. Identity and statements reviewed as written remain strict. Preserve every authored applicability condition.'};
}
export const blockingModuleFindings=(findings:unknown[],packet:Row):unknown[]=>moduleLogicReview(packet)
 ?findings.filter(finding=>!advisoryModuleFinding(finding)):findings;
/** Structural record roots preserve causal review without obliging a transcription of each leaf. */
export function moduleReviewRoot(path:string):string{
 const match=/^\/(nodes|claims)\/\d+(?=\/|$)/.exec(path);return match?.[0]??path;
}
export function moduleGuidanceApproved(approval:Row,packet:Row={}):boolean{
 const issues=Array.isArray(approval?.issues)?approval.issues:null;
 if(!issues)return false;
 if(!moduleLogicReview(packet))return approval.approved===true&&issues.length===0;
 return blockingModuleFindings(issues,packet).length===0&&
  (approval.approved===true||approval.approved===false&&issues.length>0&&issues.every(advisoryModuleFinding));
}
