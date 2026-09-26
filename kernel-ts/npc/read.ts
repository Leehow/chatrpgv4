/** Limited NPC projections from an existing authoritative snapshot. No dossier or write authority. */
import type {ModuleGraph} from '../read/module-graph.js';
import {array,number,row,string,type Row} from '../read/values.js';
import {npcNode,npcsPresent} from '../read/capsule.js';
import {withPromiseFulfillment,canonicalMemoryReceipts} from '../read/memory.js';
import {incapacitatedBy} from '../healing/conditions.js';
import {jsonDigest} from '../json.js';
import {npcPerspective} from './perspective.js';
import {responseBankFor} from './responses.js';

export async function npcViews(input:{campaign:string;graph:ModuleGraph;world:Row;meta:Row;turn:Row;memory:Row[];records:Row[];ledger:Row;
    name?:string;read(file:string):Promise<Row|null>}):Promise<Row[]> {
    const {graph,world,turn,records,ledger}=input,worldline=string(input.meta.active_worldline||'main');
    const scope={worldline,loop:number(row(row(input.meta.worldlines)[worldline]).loop)};
    const nodes=input.name?[npcNode(graph,world,input.name)]:npcsPresent(graph,world,graph.scene(world.active_scene));
    const memory=withPromiseFulfillment(input.memory,{campaign:input.campaign,world,receipts:canonicalMemoryReceipts(records,array(turn.receipts))});
    const contextRevision=jsonDigest({campaign:input.campaign,world,turn});
    return Promise.all(nodes.map(async node=>{
        const projected=npcPerspective(graph,world,node,memory,records,scope),responses=await responseBankFor({graph,world,scope},node,input.read);
        const currentInput={turn:turn.turn,player_input:turn.player_text??null,state:turn.state},handle=graph.handle(node);
        const present=row(world.npc_presence)[handle]===world.active_scene,conditions=row(row(world.npc_resources)[handle]).conditions;
        const death=array(turn.receipts).filter(receipt=>receipt.kind==='npc'&&[node.node_id,handle].includes(receipt.npc)&&typeof receipt.dead==='boolean').at(-1);
        const dead=death?death.dead:Boolean(row(ledger[string(node.node_id)]).dead);
        const availability={present,can_act:present&&!dead&&!incapacitatedBy(Array.isArray(conditions)?conditions.map(string):[]).length};
        return {...projected.view,responses,input:currentInput,scope:{...scope,campaign:input.campaign},availability,view_revision:jsonDigest({view:projected.revision,responses,input:currentInput,availability,contextRevision})};
    }));
}
