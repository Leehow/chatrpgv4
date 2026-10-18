/** Existing gameplay fixtures start after their in-fiction scope is established.
 * Scope-classification tests import the production factory directly and exercise that earlier step.
 */
export * from '../../runtime/jev/hybrid-engine.ts';
import {createHybridEngine as createEngine} from '../../runtime/jev/hybrid-engine.ts';
/** Explicit consent fixture for transport/state tests; never a production fallback. */
export const checkedAdmission={decide:async batch=>({batchId:batch.id,status:'complete',
  answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:batch.family==='held-act-outcome'||question.key.startsWith('restriction_')?.01:.99}])),
  coverage:{required:batch.questions.map(question=>question.key),answered:batch.questions.map(question=>question.key),unknown:[]},issues:[]})};
export const createHybridEngine = options => createEngine({
  interactionScope: {mode: 'world', reason: 'preclassified_gameplay_fixture', calls: 0},
  ...options,
});
