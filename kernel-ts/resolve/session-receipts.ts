/** Shared projection of canonical session-engine roll records into receipts. */
import {isJsonObject} from '../json.js';
import {array,number,row,string,truth,type Row} from '../read/values.js';
import {SUCCESS_OUTCOMES} from './arithmetic.js';
import type {SettleContext} from './context.js';
export function recordPercentile(context: SettleContext,record: Row,kind: string,extra: Row={}): string {
    const target=Math.trunc(number(record.target??record.base_target??0));
    const difficulty=string(record.required_level||record.difficulty||'regular');
    const threshold=record.required_target??context.arithmetic.difficultyTarget(target,difficulty);
    const outcome=string(record.outcome||record.achieved_level||'failure');
    return context.addRoll({actor:string(record.actor_id),skill:string(record.skill||'check'),target,difficulty,
        threshold:Math.trunc(number(threshold)),roll:Math.trunc(number(record.roll)),level:outcome,
        passed:record.passed==null?SUCCESS_OUTCOMES.has(outcome):truth(record.passed),
        bonus:Math.trunc(number(record.bonus)),penalty:Math.trunc(number(record.penalty)),visibility:'public',kind,
        engine_roll_id:record.roll_id??null,...extra});
}
export function recordDice(context: SettleContext,record: Row,label?: string|null,extra: Row={}): string {
    const dice=row(record.dice),expression=dice.expression||record.die_expression||record.die||null;
    let faces=Array.isArray(dice.raw)?dice.raw:record.die_rolls;
    if(!Array.isArray(faces))faces=record.roll==null?[]:[Math.trunc(number(record.roll))];
    const total=truth(dice)?dice.total:(Object.hasOwn(record,'effect_total')?record.effect_total:record.roll??null);
    const skill=string(record.skill||'dice');
    return context.addDiceRoll({actor:string(record.actor_id),label:skill,skill_label:label||skill,expression,
        faces:faces.map((value:any)=>Math.trunc(number(value))),total,...extra});
}
export function recordEngineRolls(context: SettleContext,records: Row[],kind: string,extra: Row={}): string[] {
    const ids:string[]=[];
    for(const record of records){
        if(!isJsonObject(record)||typeof record.roll_id!=='string')continue;
        if(record.roll_role==='amount'||record.skill==='HP Damage'||Object.hasOwn(record,'die_expression'))ids.push(recordDice(context,record,null,extra));
        else if(record.roll!=null&&(record.target!=null||record.base_target!=null))ids.push(recordPercentile(context,record,kind,extra));
    }
    return ids;
}
