/** Closed review outcomes; the reviewer owns the semantic impact judgment. */
export const MODULE_LOGIC_REVIEW='module-logic-v1';
export const MODULE_REVIEW_IMPACTS=['logic','presentation','parameter'] as const;
type Row=Record<string,any>;
export const moduleLogicReview=(packet:Row):boolean=>packet.review_policy===MODULE_LOGIC_REVIEW;
export const advisoryModuleFinding=(finding:unknown):boolean=>!!finding&&typeof finding==='object'&&
 ['presentation','parameter'].includes((finding as Row).impact);
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
