/** Shared decision-facing current facts; no routing dependency or world mutation (§208). */
import type {Json} from './contracts.ts';
export interface TurnContext {
  scene:string;clock:Json;present:string[];receipts:string[];lastExchange?:Json;temporal?:Json;outcomes?:Json[];
}
export function turnNow(context:TurnContext):Json {
  return {scene:context.scene,clock:context.clock,present:context.present,
    ...(context.temporal?{temporal:context.temporal}:{}),...(context.outcomes?.length?{outcomes:context.outcomes}:{})};
}
