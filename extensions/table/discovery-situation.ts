/** Slim current facts, not future receipts, for capability and instruction relevance (§209). */
type Row=Record<string,any>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const array=(value:unknown):Row[]=>Array.isArray(value)?value:[];
export function discoverySituation(capsule:Row,task:Row={}):Row {
    const where=object(capsule.where),mods=object(capsule.mods),known=object(capsule.known);
    const present=array(capsule.present),clues=array(known.clues_here),clocks=array(object(mods.pacing).threat_clocks);
    return {
        keeper_task:typeof task.purpose==='string'?task.purpose:'Respond to the chosen intent and portray supported world consequences.',
        task_reason:task.reason??null,
        preparation_needs:object(task.check_preparation).needs??null,
        host_operations:array(task.operations).map(operation=>({verb:operation.verb,family:operation.family,
            bound_fields:Object.keys(object(operation.bound)),needed_fields:array(operation.needs).map(need=>need.name)})),
        scene:where.display_name??where.scene??null,scene_summary:where.summary??null,
        clock:where.clock??null,temporal:where.temporal??null,
        people:present.slice(0,16).map(person=>typeof person==='string'?{name:person}:{
            name:person.name,kind:person.kind??'person',activity:person.activity??null,
            met_before:object(person.history).last_spoke_turn!=null,
        }),
        known_clues_here:clues.slice(0,8).map(clue=>({name:clue.name,delivery:clue.delivery??null})),
        threat_clocks:clocks.slice(0,8).map(clock=>({name:clock.name,current_segments:clock.current_segments??null})),
        unregistered_equipment:array(mods.unregistered_equipment).length,
        registered_objects:array(object(mods.objects).instances).length,
        reentry:object(mods.thread).reentry??null,
        compile:object(task.compile).features??task.features??null,
        limits:{people_omitted:Math.max(0,present.length-16),clues_omitted:Math.max(0,clues.length-8),
            clocks_omitted:Math.max(0,clocks.length-8)},
    };
}
