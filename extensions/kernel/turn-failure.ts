import authored from '../../content/ui/en/extension.json' with {type:'json'};
import {STATUS_CODES} from 'node:http';
import {fill} from '../ui/words.ts';

/** Bounded system diagnostics; never copy model content or operation arguments. */
export interface TurnFailureState {
 turn:number;
 turnFailure?:{
  turn:number;
  failures:Array<{operation:string;code:string;message:string;reason?:string;cause?:string;admission?:{selection:number[];scope:number[];minimum?:number}}>;
  completion?:{stop_reason:string|null;blocks:string[]};
  settled_receipts?:number;
 };
}
export function turnFailure(state:TurnFailureState):NonNullable<TurnFailureState['turnFailure']>{
 if(state.turnFailure?.turn!==state.turn)state.turnFailure={turn:state.turn,failures:[]};
 return state.turnFailure!;
}
export function rememberTurnFailure(state:TurnFailureState,operation:string,error:unknown,depth=0):void{
 const row=error as {code?:unknown;message?:unknown;details?:Record<string,unknown>;cause?:unknown}|null;
 const short=(value:unknown)=>typeof value==='string'?value.slice(0,1200):undefined;
 const details=row?.details;
 const scores=details?.admission_probabilities as {selection?:unknown;scope?:unknown;minimum?:unknown}|undefined;
 const probabilities=(value:unknown)=>Array.isArray(value)?value.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1).slice(0,16):[];
 // V8 syntax messages may quote the private JSON body; report the parser stage without that excerpt.
 const syntax=error instanceof SyntaxError;
 const failure={operation,code:short(row?.code)??(syntax?'invalid_json':'internal'),
  message:syntax?'Invalid JSON at this operation.':short(row?.message)??String(error).slice(0,1200),
  ...(short(details?.reason)?{reason:short(details?.reason)}:{}),
  ...(short(details?.jev_reason??details?.cause)?{cause:short(details?.jev_reason??details?.cause)}:{}),
  ...(scores?{admission:{selection:probabilities(scores.selection),scope:probabilities(scores.scope),
   ...(typeof scores.minimum==='number'&&Number.isFinite(scores.minimum)?{minimum:scores.minimum}:{})}}:{})};
 const failures=turnFailure(state).failures;
 if(failures.some(previous=>JSON.stringify(previous)===JSON.stringify(failure)))return;
 failures.push(failure);
 if(failures.length>6)failures.splice(3,1);
 if(row?.cause!==undefined&&row.cause!==error&&depth<2)rememberTurnFailure(state,operation+'.cause',row.cause,depth+1);
}
export function unfinishedTurnFailure(state:TurnFailureState&{inputEnded?:{turn:number;cause:string};runAbandoned?:boolean}){
 const diagnostic=turnFailure(state);
 return {turn:state.turn,status:'unfinished',
  stopped_by:state.inputEnded?.turn===state.turn?state.inputEnded.cause:state.runAbandoned?'run_aborted':'missing_final_output',
  failures:diagnostic.failures.length?diagnostic.failures:[{operation:'keeper_completion',code:state.runAbandoned?'run_aborted':'missing_final_output',
   message:'The Keeper run ended without a successful output or ask publication.'}],
  ...(diagnostic.completion?{completion:diagnostic.completion}:{}),
  settled_receipts:diagnostic.settled_receipts??null};
}

/** A closed diagnostic vocabulary selects authored captions, never classifies player prose. */
export function turnFailureNotice(value:unknown, captions:Record<string,string>|{line(key:string,values?:Record<string,unknown>):string}={}):{content:string;label:string}|undefined {
 const failure=value as ReturnType<typeof unfinishedTurnFailure>|undefined;
 if(!failure||failure.status!=='unfinished'||!Array.isArray(failure.failures)||!failure.failures.length)return;
 const words=typeof captions.line==='function' ? captions as {line(key:string,values?:Record<string,unknown>):string}
  :{line:(key:keyof typeof authored,values:Record<string,unknown>={})=>fill((captions as Record<string,string>)[key]??authored[key],values)};
 const rows=failure.failures.filter(row=>row&&typeof row.operation==='string'&&typeof row.code==='string');
 if(!rows.length)return;
 const provider=rows.find(row=>row.code==='provider_error'),status=provider?.reason?.match(/^provider_http_([45]\d{2})$/)?.[1];
 let content:string;
 if(provider)content=words.line('turn_failure_operation',{operation:provider.operation,code:status?`HTTP ${status} ${STATUS_CODES[status]??''}`:provider.reason??provider.code});
 else if(rows.some(row=>row.code==='ENOTDIR'))content=words.line('turn_failure_output_path');
 else if(rows.some(row=>row.reason==='action_admission_uncertain'))content=words.line('turn_failure_admission');
 else if(rows.some(row=>row.reason==='place_observation_point_unresolved'))content=words.line('turn_failure_observation_point');
 else if(rows.some(row=>row.reason==='native_output_missing'))content=words.line('turn_failure_missing_output');
 else if(rows.some(row=>row.code==='invalid_json'))content=words.line('turn_failure_invalid_output');
 else if(rows.some(row=>row.code==='run_aborted'))content=words.line('turn_failure_interrupted');
 else if(rows.every(row=>row.code==='missing_final_output'))content=words.line('turn_failure_missing_output');
 else {
  const row=rows.at(-1)!;
  content=words.line('turn_failure_operation',{operation:row.operation,code:row.reason??row.code});
 }
 content+=' '+(failure.settled_receipts===0?words.line('turn_failure_no_settlement')
  :typeof failure.settled_receipts==='number'?words.line('turn_failure_settlement_kept')
  :words.line('turn_failure_settlement_unknown'));
 return {content,label:words.line('turn_failure_details')};
}
