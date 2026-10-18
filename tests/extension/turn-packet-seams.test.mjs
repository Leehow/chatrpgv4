/** Deterministic seam regressions; these are not live gameplay evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnPacketProviderPayload,bindTurnPacketMoves,turnPacketMovementChoices,compileTurnPacket,turnPacket,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';

test('NPC destinations expose and enforce the same closed issued capabilities',()=>{
 const payload={tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}]};
 const schema=turnPacketProviderPayload(payload,false,true,[],[{kind:'move',to:'Library'}]).tools[0].input_schema;
 const npc=schema.properties.commands.anyOf[0].items.anyOf.find(row=>row.properties?.kind?.const==='npc');
 assert.deepEqual(npc.properties.to.enum,['here','away','Library']);
 const packet={version:3,commands:[{kind:'npc',actor:'npc_1',to:'street',reason:'leaves'}],responses:[]};
 assert.throws(()=>bindTurnPacketMoves(packet,[{kind:'move',to:'Library'}]),/NPC destination/);
 for(const to of ['here','away','Library'])assert.equal(bindTurnPacketMoves({...packet,commands:[{...packet.commands[0],to}]},[{kind:'move',to:'Library'}]).commands[0].to,to);
});
import {importSource} from '../integration/support.ts';
import {decisionScene,decisionClock} from '../../runtime/isolated-expression.ts';

test('even pure travel gives the author current public presence without NPC secrets',()=>{
 const scene=decisionScene({where:{scene:'Inn',clock:{minutes:10}},present:[{ref:'npc_2',display_name:'the clerk',name_known:false,book_name:'SECRET NAME',keeper_note:'SECRET MOTIVE'}]});
 assert.deepEqual(scene.presence.people,[{ref:'npc_2',display_name:'the clerk',name_known:false}]);
 assert.equal(scene.presence.registered_complete,true);assert.ok(!JSON.stringify(scene).includes('SECRET'));
 assert.equal(decisionScene({present:[{kind:'creature'}]}).presence.registered_complete,false);
});
test('elapsed duration and old assessment clocks are not competing current times in author material',()=>{
 assert.deepEqual(decisionClock({at:'1920-10-12T20:46',day_part:'evening',minutes:646,elapsed:'10 h 46 min'}),{at:'1920-10-12T20:46',day_part:'evening'});
 assert.deepEqual(decisionClock({minutes:646,elapsed:'10 h 46 min'}),{});
 const current=decisionScene({where:{temporal:{current:true,service:'open',crowd:'quiet',recorded_clock:{at:'1920-10-12T08:00',elapsed:'22 h'},anchor:{minutes:0},review_at_minutes:700}},present:[]});
 assert.equal(current.temporal.recorded_clock,undefined);assert.equal(current.temporal.service,'open');
 assert.deepEqual(decisionScene({where:{temporal:{current:false,crowd:'empty',service:'closed',summary:'An old closed shift.'}}}).temporal,{current:false});
});

test('MiniMax native routine uses its supported tool strategy without disabling thinking or changing other providers',()=>{
 const payload={model:'MiniMax-M3.1-Flash-Preview',thinking:{type:'adaptive'},output_config:{effort:'medium'},tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}]};
 const sent=turnPacketProviderPayload(payload);
 assert.deepEqual(sent.tool_choice,{type:'auto'});
 assert.equal(sent.thinking,payload.thinking);assert.equal(sent.output_config,payload.output_config);
 assert.equal(turnPacketProviderPayload({...payload,model:'other-model'}).tool_choice,undefined);
 assert.equal(turnPacketProviderPayload(payload,false,false).tool_choice,undefined,'known reference mode retains direct answers');
 const constrained=turnPacketProviderPayload(payload,false,true,['quick_observation','speak_briefly']);
 const variants=constrained.tools[0].input_schema.properties.commands.anyOf.flatMap(branch=>branch.items.anyOf);
 assert.deepEqual(variants.find(row=>row.properties.kind.const==='time').properties.band.enum,['quick_observation','speak_briefly']);
});

test('routine move schema selects issued destinations without free route text',()=>{
 const payload={model:'MiniMax-M3.1-Flash-Preview',tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}]};
 const sent=turnPacketProviderPayload(payload,false,true,['quick_observation'],[{kind:'move',to:'Library',via:'Main Street'}]);
 const variants=sent.tools[0].input_schema.properties.commands.anyOf.flatMap(branch=>branch.items.anyOf);
 const move=variants.find(row=>row.properties.kind.const==='move');
 assert.deepEqual(move.properties.to.enum,['Library']);
 assert.equal(move.properties.via,undefined);
 const packet={version:3,commands:[{kind:'move',to:'Library'}],responses:[]};
 assert.deepEqual(bindTurnPacketMoves(packet,[{kind:'move',to:'Library',via:'Main Street'}]).commands,[{kind:'move',to:'Library',via:'Main Street'}]);
 assert.throws(()=>bindTurnPacketMoves({...packet,commands:[{kind:'move',to:'Library',via:'Side Alley'}]},[{kind:'move',to:'Library'}]));
 assert.throws(()=>bindTurnPacketMoves(packet,[]));
 assert.throws(()=>bindTurnPacketMoves(packet,[{kind:'move',to:'Library'},{kind:'move',to:'Library',via:'Main Street'}]));
});

test('an unbound route stays visible to the Keeper and is required before settlement',()=>{
 const choices=turnPacketMovementChoices([{effects:[{kind:'move',to:'Outskirts'}],requires_via:true},{effects:[{kind:'move',to:'Library',via:'Main Street',travel_minutes:17}]}]);
 const schema=turnPacketProviderPayload({tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}]},false,true,[],choices).tools[0].input_schema;
 const moves=schema.properties.commands.anyOf[0].items.anyOf.filter(row=>row.properties?.kind?.const==='move');
 assert.deepEqual(moves.find(row=>row.properties.to.enum.includes('Outskirts')).required,['kind','to','via']);
 assert.equal(moves.find(row=>row.properties.to.enum.includes('Library')).properties.via,undefined);
 const packet={version:3,commands:[{kind:'move',to:'Outskirts'}],responses:[]};
 assert.throws(()=>bindTurnPacketMoves(packet,choices),/requires.*via/);
 const bound=bindTurnPacketMoves({...packet,commands:[{kind:'move',to:'Outskirts',via:'Follow the selected east road to the billboard.'}]},choices);
 assert.deepEqual(compileTurnPacket(bound).effects,bound.commands);
 assert.equal(compileTurnPacket(bindTurnPacketMoves({...packet,commands:[{kind:'move',to:'Library'}]},choices)).effects[0].travel_minutes,17);
 assert.equal(compileTurnPacket(bindTurnPacketMoves({...packet,commands:[{kind:'move',to:'Library'}]},[{kind:'move',to:'Library',travel_band:'local_travel'}])).effects[0].travel_band,'local_travel');
 assert.throws(()=>turnPacket(JSON.stringify({...packet,commands:[{kind:'move',to:'Library',travel_minutes:999}]})),/Invalid decision command/,'model cannot supply host-only travel values');
});

test('untimed journey bands share provider, parser, binding and canonical effect fields',()=>{
 const bands=['adjacent','local_travel','long_travel'];
 const choices=turnPacketMovementChoices([{effects:[{kind:'move',to:'Annex'}],travel_bands:bands,requires_via:true},
  {effects:[{kind:'move',to:'Library',travel_minutes:17}]}]);
 const schema=turnPacketProviderPayload({tools:[{name:'output',input_schema:TURN_PACKET_PARAMETERS}]},false,true,[],choices).tools[0].input_schema;
 const moves=schema.properties.commands.anyOf[0].items.anyOf.filter(row=>row.properties?.kind?.const==='move');
 const annex=moves.find(row=>row.properties.to.enum.includes('Annex'));
 assert.deepEqual(annex.required,['kind','to','via','travel_band']);assert.deepEqual(annex.properties.travel_band.enum,bands);
 assert.equal(moves.find(row=>row.properties.to.enum.includes('Library')).properties.travel_band,undefined);
 const packet={version:3,commands:[{kind:'move',to:'Annex',via:'The established public road.'}],responses:[]};
 for(const travel_band of [undefined,'invented'])assert.throws(()=>bindTurnPacketMoves({...packet,commands:[{...packet.commands[0],...(travel_band?{travel_band}:{})}]},choices),/requires one issued travel_band/);
 const parsed=turnPacket(JSON.stringify({...packet,commands:[{...packet.commands[0],travel_band:'local_travel'}]}));
 assert.deepEqual(compileTurnPacket(bindTurnPacketMoves(parsed,choices)).effects,[{kind:'move',to:'Annex',via:'The established public road.',travel_band:'local_travel'}]);
 assert.throws(()=>bindTurnPacketMoves({...packet,commands:[{kind:'move',to:'Library',travel_band:'local_travel'}]},choices),/host-owned timing/);
});

test('route requirements share the transaction structural reachability rules',async()=>{
 const {moveAccess,stageMove}=await importSource('kernel-ts/apply/move.ts');
 const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
 const graph=new ModuleGraph('fixture',{nodes:[{node_id:'scene:office',node_kind:'scene',name:'Office'},{node_id:'scene:outskirts',node_kind:'scene',name:'Outskirts'}],edges:[]},'fixture');
 const world={active_scene:'office',scene_trail:[]},current=graph.scene('office'),destination=graph.scene('outskirts');
 assert.equal(moveAccess(graph,world,current,destination).requiresVia,true);
 assert.throws(()=>stageMove({graph,world,turn:{turn:1},callId:'test',ordinal:1},{kind:'move',to:'outskirts'}),error=>error.code==='not_reachable');
 world.scene_trail=[graph.handle(destination)];
 assert.equal(moveAccess(graph,world,current,destination).requiresVia,false);
 assert.equal(moveAccess(graph,{scene_trail:[]},current,destination,true).requiresVia,false);
});

test('an offstage telephone speaker is a discrepancy, never an instruction to teleport',async()=>{
 const {unrecordedPeople}=await importSource('kernel-ts/read/assemble.ts');
 const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
 const graph=new ModuleGraph('fixture',{nodes:[{node_id:'scene:office',node_kind:'scene',name:'Office'},{node_id:'npc:clerk',node_kind:'npc',name:'Clerk'}],edges:[]},'fixture');
 const rows=unrecordedPeople(graph,{active_scene:'office',npc_presence:{clerk:'library'}},graph.scene('office'),[{turn:1,speech:[{who:{npc:'clerk'},text:'I am calling from the library.'}],receipts:[]}],2);
 assert.equal(rows.length,1);assert.equal(rows[0].at,'library');
 assert.equal(rows[0].presence_established,false);
 assert.ok(!rows[0].line.includes('makes the two agree'));
});
