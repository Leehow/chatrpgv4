/** Existing gameplay fixtures start after their in-fiction scope is established.
 * Scope-classification tests import the production factory directly and exercise that earlier step.
 */
export * from '../../runtime/jev/hybrid-engine.ts';
import {createHybridEngine as createEngine} from '../../runtime/jev/hybrid-engine.ts';
export const createHybridEngine = options => createEngine({
  interactionScope: {mode: 'world', reason: 'preclassified_gameplay_fixture', calls: 0},
  ...options,
});
