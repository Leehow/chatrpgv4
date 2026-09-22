/** Lazy encounter continuity. No offstage simulation and no mechanical effect inferred from prose. */
import {RpcError} from '../errors.js';
import {isJsonObject,jsonDigest} from '../json.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array,normalize,number,row,string,type Row} from '../read/values.js';

function presence(snapshot:Row,handle:string,names:Set<string>):boolean {
    if(typeof snapshot.active_scene==='string')return row(snapshot.npc_presence)[handle]===snapshot.active_scene;
    // Committed turns retain the authoritative compact table snapshot, not the mutable world file.
    return array(snapshot.present).some(name=>typeof name==='string'&&names.has(normalize(name)));
}
function encounter(graph:ModuleGraph,node:Row,record:Row):boolean {
    const handle=graph.handle(node),names=new Set(graph.nameKeys(node).map(normalize));
    return array(record.speech).some(line=>row(line.who).npc===handle)
        ||array(record.receipts).some(receipt=>['npc','target_npc','from','with','actor','subject'].some(key=>
            typeof receipt[key]==='string'&&names.has(normalize(receipt[key]))));
}
export function reunionInterval(graph:ModuleGraph,world:Row,node:Row,records:Row[],scope:Row):Row|null {
    const handle=graph.handle(node),names=new Set(graph.nameKeys(node).map(normalize));
    if(!presence(world,handle,names))return null;
    const history=records.filter(r=>r.commit&&(r.worldline==null||r.worldline===(scope.worldline??'main'))
        &&(r.loop==null||number(r.loop)===number(scope.loop))).sort((a,b)=>number(a.turn)-number(b.turn));
    let absent=-1;
    for(let index=history.length-1;index>=0;index--)if(!presence(row(history[index].world),handle,names)){absent=index;break;}
    if(absent<0)return null;
    const before=history.slice(0,absent),seen=before.filter(r=>presence(row(r.world),handle,names));
    if(!seen.some(r=>encounter(graph,node,r)))return null;
    const last=seen.at(-1)!;
    const arrival=history.slice(absent+1).find(r=>presence(row(r.world),handle,names));
    const minutes=number(row((arrival?row(arrival.world):world).clock).minutes)-number(row(row(last.world).clock).minutes);
    if(minutes<=0)return null;
    const at={from_turn:number(last.turn),last_absent_turn:number(history[absent].turn),scope};
    return {...at,key:jsonDigest({npc:node.node_id,...at}),elapsed_minutes:minutes,
        last_words:array(last.speech).filter(line=>row(line.who).npc===handle).map(line=>string(line.text))};
}
export function reunionView(graph:ModuleGraph,world:Row,node:Row,records:Row[],scope:Row={}):Row|null {
    const interval=reunionInterval(graph,world,node,records,scope);
    if(!interval)return null;
    const accepted=row(row(row(row(world.npc_character)[string(node.node_id)]).reunions)[interval.key]);
    if(accepted.content_digest)return {status:'established',elapsed_minutes:accepted.elapsed_minutes,background:accepted.background,
        reports:accepted.reports,open_threads:accepted.open_threads,origin:'table_established',
        note:'Keep established background unchanged. Reports remain this person\'s claims; open threads are not obligations. Additional unestablished detail may use reunion extend true.'};
    return {status:'needed',elapsed_minutes:interval.elapsed_minutes,last_seen_words:interval.last_words,
        next:{tool:'apply',kind:'npc',name:graph.displayName(node),field:'reunion'},
        note:'When this encounter needs a continuation, invent only a modest compatible interval, or establish a quiet interval. Preserve personality, existing facts, commitments and player choices. Apply NPC reunion records background, attributed reports and optional open threads; it grants no mechanical effect. No offstage turns need to be simulated.'};
}
function checked(value:unknown):Row {
    if(!isJsonObject(value)||Object.keys(value).some(k=>!['background','reports','open_threads','extend'].includes(k))
        ||value.extend!==undefined&&typeof value.extend!=='boolean')throw new RpcError('invalid_params','Invalid NPC reunion shape');
    const result:Row={};
    for(const key of ['background','reports','open_threads']){
        const lines=value[key]??[];
        if(!Array.isArray(lines)||lines.length>4||lines.some(line=>typeof line!=='string'||!line.trim()||Array.from(line).length>600))
            throw new RpcError('invalid_params',`reunion.${key} must contain at most four nonempty bounded lines`);
        result[key]=[...new Set(lines.map(line=>string(line).trim()))];
    }
    return result;
}
export function acceptReunion(graph:ModuleGraph,world:Row,node:Row,records:Row[],scope:Row,value:unknown,turn:number):Row {
    const interval=reunionInterval(graph,world,node,records,scope);
    if(!interval)throw new RpcError('invalid_params','No elapsed return encounter is available for this person',{details:{reason:'npc_reunion_not_due'}});
    const candidate=checked(value),characters=(world.npc_character??={}),person=(characters[string(node.node_id)]??={}),reunions=(person.reunions??={});
    const old=row(reunions[interval.key]),extend=row(value).extend===true;
    if(old.content_digest){
        if(old.content_digest===jsonDigest(candidate))return {...reunionView(graph,world,node,records,scope),reused:true};
        if(!extend)throw new RpcError('idempotency_conflict','This encounter already has accepted continuity; do not rewrite its past');
        for(const key of ['background','reports','open_threads'])candidate[key]=[...new Set([...array(old[key]),...candidate[key]])];
        if(Object.values(candidate).some(lines=>array(lines).length>16))throw new RpcError('invalid_params','This reunion already has enough retained detail');
    }
    reunions[interval.key]={...candidate,content_digest:jsonDigest(candidate),scope,from_turn:interval.from_turn,
        last_absent_turn:interval.last_absent_turn,elapsed_minutes:old.elapsed_minutes??interval.elapsed_minutes,accepted_turn:old.accepted_turn??turn,updated_turn:turn};
    return {...reunionView(graph,world,node,records,scope),...(old.content_digest?{extended:true}:{})};
}
