/** Contract §247.2: the package that lets the Keeper carry routine acts as one summarized stretch. */
import {array,type Row} from './values.js';
export const ROUTINE_SUMMARY_CAPABILITY='turn.routine-summary.v1';
/** The last active package requiring the capability, as `location_context` names its provider. */
export function routineSummaryProvider(active:readonly Row[]):Row|undefined {
    return active.filter(mod=>array(mod.requires).includes(ROUTINE_SUMMARY_CAPABILITY)).at(-1);
}
