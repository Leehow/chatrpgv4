/** Public evidence for selected physical writing, independent of the Keeper capsule window (§227.5). */
import {onLine} from '../read/exchange.js';
import {array,number,row,string,type Row} from '../read/values.js';

const day=(clock:Row):string=>typeof clock.at==='string'?clock.at.slice(0,10):string(clock.day??'');
/** Delivery snapshots retain elapsed minutes; recover their day from the same public clock anchor. */
function recordedDay(clock:Row,current:Row):string {
    if(day(clock))return day(clock);
    if(typeof clock.minutes!=='number')return '';
    const delta=clock.minutes-number(current.minutes);
    if(typeof current.at==='string')return new Date(Date.parse(current.at+'Z')+delta*60000).toISOString().slice(0,10);
    if(typeof current.day==='number')return String(current.day+Math.floor((Number(current.hh)*60+Number(current.mm)+delta)/1440));
    return '';
}
export function documentKnowledge(view:Row,records:Row[],meta:Row):Row {
    const currentDay=day(row(view.clock)),worldline=string(meta.active_worldline||'main');
    const scope={worldline,loop:number(row(row(meta.worldlines)[worldline]).loop)};
    const narrations=records.filter(record=>record.commit&&onLine(record,scope)&&number(record.turn)<number(view.turn))
        .filter(record=>{
            const start=recordedDay(row(row(row(record.capsule).where).clock),row(view.clock)),end=recordedDay(row(row(record.world).clock),row(view.clock));
            return currentDay!==''&&(start===currentDay||end===currentDay);
        }).sort((a,b)=>number(a.turn)-number(b.turn)).flatMap(record=>{
            const text=record.rendered_text??record.text;
            return typeof text==='string'&&text?[{turn:record.turn,text}]:[];
        });
    return {day:currentDay,clues:array(row(view.clues).discovered).map(clue=>({label:clue.label,...(clue.how?{how:clue.how}:{})})),
        handouts:array(view.handouts).map(handout=>({name:handout.name,text:handout.text})),narrations};
}
