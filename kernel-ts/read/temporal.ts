/** Clock applicability of Keeper-authored context, not a semantic routine scheduler (§208). */
import {clockSection,clockStart} from './capsule.js';
import {clone,number,row,string,type Row} from './values.js';
import type {ModuleGraph} from './module-graph.js';

export function temporalAnchor(graph:ModuleGraph,world:Row):Row {
    const start=clockStart(graph,row(world.clock));
    return {at:start.at?.toISOString().slice(0,16)??null,minutes:start.minutes};
}
const day=(clock:Row)=>typeof clock.at==='string'?clock.at.slice(0,10):string(clock.day);
export function activityView(graph:ModuleGraph,world:Row,record:unknown,scene:string|null):Row {
    const saved=row(record),clock=clockSection(graph,world),previous=row(saved.recorded_clock),reasons:string[]=[];
    if(!Object.keys(saved).length)return {current:false,review_required:true,review_reasons:['unassessed']};
    if(JSON.stringify(saved.anchor)!==JSON.stringify(temporalAnchor(graph,world)))reasons.push('anchor_changed');
    if(day(previous)!==day(clock))reasons.push('day_changed');
    if(previous.day_part!==clock.day_part)reasons.push('day_part_changed');
    if(number(previous.minutes)>number(clock.minutes))reasons.push('clock_rewound');
    if(saved.review_at_minutes!=null&&number(clock.minutes)>=number(saved.review_at_minutes))reasons.push('review_boundary_reached');
    if(saved.scene!==scene)reasons.push('scene_changed');
    return {...clone(saved),current:reasons.length===0,review_required:reasons.length>0,review_reasons:reasons};
}
export function npcActivityView(graph:ModuleGraph,world:Row,handle:string):Row {
    const saved=row(world.npc_activity)[handle];
    return activityView(graph,world,saved,typeof row(world.npc_presence)[handle]==='string'?row(world.npc_presence)[handle]:null);
}
export function sceneTemporalView(graph:ModuleGraph,world:Row,scene:Row):Row {
    const handle=graph.handle(scene);
    return activityView(graph,world,row(world.scene_activity)[handle],handle);
}
export function actuallyAsleep(activity:Row|undefined):boolean {
    return activity?.current===true&&activity.wakefulness==='asleep'&&['observed','established'].includes(string(activity.basis));
}
