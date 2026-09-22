/** Build a portable evidence viewer. UI interactions replay measured inputs, not simulated Jev output. */
import fs from 'node:fs/promises';
import path from 'node:path';
const [source,performancesPath]=process.argv.slice(2);
if(!source)throw new Error('Usage: node render.mjs <run-directory> [performances.json]');
const dir=path.resolve(source),read=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
const data={records:await read('records.json'),summary:await read('summary.json'),personas:await read('personas.json'),manifest:await read('manifest.json'),performances:performancesPath?JSON.parse(await fs.readFile(path.resolve(performancesPath),'utf8')):null};
const encoded=JSON.stringify(data).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NPC personality laboratory</title>
<style>
:root{font:16px/1.65 system-ui,sans-serif;color:#24322e;background:#f4f6f2;--accent:#246d54}*{box-sizing:border-box}body{max-width:1180px;margin:36px auto;padding:0 24px}h1{font-size:32px;line-height:1.2;margin-bottom:12px}h2{font-size:19px}h3{font-size:15px;color:#647269;margin:0 0 8px}p{margin:8px 0}button,select{font:inherit;padding:8px 13px;border:1px solid #c7d5ca;border-radius:8px;background:white;cursor:pointer;color:inherit}button:hover{border-color:var(--accent)}button.active{background:var(--accent);color:white}.muted{color:#65746c}.note{padding:12px 16px;border-left:3px solid var(--accent);background:#eaf0e8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:white;padding:20px;border:1px solid #dde5dc;border-radius:12px;overflow-wrap:anywhere}.wide{grid-column:1/-1}nav,.buttons{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.pill{display:inline-block;padding:3px 9px;border-radius:20px;background:#e8eee7;font-size:13px;margin:3px}.bad{background:#ffedcc;color:#754c05}.metrics{display:flex;gap:18px;flex-wrap:wrap}.metric{background:white;min-width:145px;padding:14px 20px;border-radius:10px}.metric b{display:block;font-size:24px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5eae2;vertical-align:top}tr.chosen{background:#eaf4ed}code{font-size:12px}pre{white-space:pre-wrap;font-size:12px;max-height:460px;overflow:auto}blockquote{margin:12px 0;padding:12px 18px;border-left:3px solid #82a792;background:#f6f8f4}.bar{height:5px;width:72px;background:#e5eae2}.bar span{display:block;height:5px;background:var(--accent)}a{color:var(--accent)}@media(max-width:760px){body{padding:0 14px}.grid{grid-template-columns:1fr}th,td{padding:7px}h1{font-size:26px}.metric{min-width:120px}}
</style>
<header><span class="pill">THROWAWAY PROTOTYPE · REAL API RECORDS</span><h1>NPC personality laboratory</h1><p>Does personality and shared history change an NPC's response while the player keeps the spotlight?</p><p class="note">Buttons replay recorded Jev requests and real tool-enabled author output. They do not call a model, simulate a campaign, or establish world facts. The API key is not included. Scores are evidence-fit ratings, not permanent character stats.</p></header>
<div class="metrics" id="metrics"></div><nav id="tabs"></nav><div class="note" id="guide"></div><div class="buttons" id="steps"></div>
<section class="card"><h3>Explore measured situations</h3><div class="buttons"><select id="case"></select><select id="arm"><option value="full">Full character context</option><option value="without_personality">Remove personality</option><option value="without_relationship">Remove shared history</option></select><button id="order">Reverse candidate order / second call</button><button id="invalidate">Player changes the request</button><button id="reset">Restore recorded request</button></div><p id="availability" class="muted"></p></section>
<div class="grid" id="state" style="margin-top:16px"></div><section class="card" style="margin-top:16px"><h2>What this evidence can establish</h2><p id="limits"></p><p>The known-fact filter is host-owned. Keeping the canary out of the request does not prove Jev can keep secrets after seeing them. Two reversed-order calls are correlated observations, not a reliability benchmark. The prototype does not measure full Keeper turns.</p><details><summary>Full relevant recorded state and result</summary><pre id="raw"></pre></details></section>
<script type="application/json" id="data">${encoded}</script><script>
const DATA=JSON.parse(document.getElementById('data').textContent);
const walks=[
 {id:'personality',label:'Personality',description:'Same request and scene; change only the stored personality. Then remove it or reverse candidate order.',steps:[['Principled','personality-principled'],['Loyal','personality-loyal'],['Commercial','personality-commercial']]},
 {id:'relationship',label:'Shared history',description:'The same personality receives the same loan request. Compare a kept promise, an unrepaired breach and no previous meeting.',steps:[['Kept promise','relation-trusted'],['Broken promise','relation-betrayed'],['Stranger','relation-stranger']]},
 {id:'knowledge',label:'Limited knowledge',description:'The host excludes facts the NPC never learned, including an unrelated secret. An adversarial player utterance must not grant knowledge.',steps:[['Seen the seal','knowledge-known'],['Never seen it','knowledge-unknown'],['Pressure to invent','knowledge-injection']]},
 {id:'spotlight',label:'Player focus',description:'Closing a conversation, a negated threat and a bad candidate set should not create new obligations.',steps:[['Natural goodbye','spotlight-goodbye'],['Negated threat','language-negation'],['No suitable action','candidate-gap']]},
 {id:'reunion',label:'Reunion',description:'One tool-enabled author generated this personality once; a later task received that exact stored description and filled a three-day gap. This draft has been reviewed, not committed to a game.',steps:[]}
];
const initial=()=>({tab:'personality',caseId:'personality-principled',arm:'full',repeat:1,stale:false});
function reduce(state,action){
 if(action.type==='tab'){const walk=walks.find(w=>w.id===action.id);return {...initial(),tab:action.id,caseId:walk.steps[0]?.[1]??state.caseId};}
 if(action.type==='case')return {...state,caseId:action.id,arm:'full',stale:false};
 if(action.type==='arm')return {...state,arm:action.arm,stale:false};
 if(action.type==='order')return {...state,repeat:state.repeat===1?2:1,stale:false};
 if(action.type==='invalidate')return {...state,stale:true};
 if(action.type==='restore')return {...state,stale:false};
 return state;
}
let current=initial();
const el=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dispatch=action=>{current=reduce(current,action);render();};
const choose=(id)=>dispatch({type:'case',id});
el('case').innerHTML=[...new Set(DATA.records.map(r=>r.case_id))].map(id=>'<option>'+esc(id)+'</option>').join('');
el('case').onchange=e=>choose(e.target.value);el('arm').onchange=e=>dispatch({type:'arm',arm:e.target.value});
el('order').onclick=()=>dispatch({type:'order'});el('invalidate').onclick=()=>dispatch({type:'invalidate'});el('reset').onclick=()=>dispatch({type:'restore'});
const metric=(label,value)=>'<div class="metric"><b>'+esc(value)+'</b>'+esc(label)+'</div>';
el('metrics').innerHTML=metric('valid API calls',DATA.summary.valid_calls+'/'+DATA.summary.planned_calls)+metric('typed questions',DATA.summary.questions)+metric('median request',DATA.summary.latency_ms.median+' ms')+metric('listed input estimate','$'+DATA.summary.usage.estimatedUsd.toFixed(4));
el('limits').textContent=DATA.summary.limits;
function render(){
 const walk=walks.find(w=>w.id===current.tab);el('tabs').innerHTML='';for(const w of walks){const b=document.createElement('button');b.textContent=w.label;b.className=w.id===current.tab?'active':'';b.onclick=()=>dispatch({type:'tab',id:w.id});el('tabs').append(b);}
 el('guide').textContent=walk.description;el('steps').innerHTML='';for(const [label,id] of walk.steps){const b=document.createElement('button');b.textContent=label;b.onclick=()=>choose(id);el('steps').append(b);}
 el('case').value=current.caseId;el('arm').value=current.arm;
 const r=DATA.records.find(r=>r.case_id===current.caseId&&r.arm===current.arm&&r.repeat===current.repeat);
 if(current.tab==='reunion'){
  const p=DATA.personas.personas.find(p=>p.id==='sparse'),x=DATA.performances?.reunion;
  el('availability').textContent='Reunion is a stored authoring sample. The response controls apply to decision cases.';
  el('state').innerHTML='<article class="card"><h3>Stored personality</h3><p>'+esc(p.description)+'</p><h3>Generated additions</h3><p>'+esc(p.generated_additions?.join(' / '))+'</p></article><article class="card"><h3>Three days later</h3><blockquote>'+esc(x?.narrative??'Authoring sample unavailable.')+'</blockquote></article>'+(x?'<article class="card wide"><h3>Draft background details</h3><p>'+esc(x.established_details?.join(' / '))+'</p><h3>Attributed NPC reports</h3><p>'+esc(x.npc_reports?.join(' / '))+'</p><h3>Still open to the player</h3><p>'+esc(x.open_proposals?.join(' / '))+'</p></article>':'');el('raw').textContent=JSON.stringify({personality:p,reunion:x},null,2);return;
 }
 if(!r){el('availability').textContent='This combination was not measured. No answer is invented. Choose Full character context or another situation.';el('state').innerHTML='';el('raw').textContent='No record';return;}
 const chosenAlias=Object.entries(r.binding).find(([,id])=>id===r.selected)?.[0],chosen=r.state.options.find(o=>o.alias===chosenAlias),speech=DATA.performances?.responses.find(x=>x.id===r.case_id);
 el('availability').textContent=current.stale?'The current request has changed. This recorded suggestion is stale and cannot be adopted. Restore the input to inspect it.':'Showing an actual request and result: '+r.id+' · '+r.wall_ms+' ms · '+r.result.status;
 const facts=r.state.npc.known_facts.map(x=>x.text).join(' / ')||'No relevant fact known.';
 const history=r.state.npc.relationship_events.map(x=>x.text).join(' / ')||'No recorded shared history.';
 const score=n=>n===null?'Unavailable':Number(n).toFixed(2)+'<div class="bar"><span style="width:'+Math.max(0,Math.min(100,n/4*100))+'%"></span></div>';
 let rows=r.state.options.map(o=>{const id=r.binding[o.alias],s=r.scores[id],prob=r.result.answers?.response?.probabilities?.[o.alias];return '<tr class="'+(!current.stale&&id===r.selected?'chosen':'')+'"><td>'+esc(o.response)+'</td><td>'+score(s.personality)+'</td><td>'+score(s.relationship)+'</td><td>'+score(s.context)+'</td><td>'+esc(prob??'N/A')+'</td></tr>';}).join('');
 el('state').innerHTML='<article class="card"><h3>Personality</h3><p>'+esc(r.state.npc.personality??'Removed in this measured ablation.')+'</p><h3>Shared history</h3><p>'+esc(history)+'</p></article><article class="card"><h3>Scene</h3><p>'+esc(r.state.scene)+'</p><h3>Player says</h3><blockquote>'+esc(r.state.player_input)+'</blockquote><h3>This NPC knows</h3><p>'+esc(facts)+'</p></article><article class="card wide"><h3>Measured choice</h3><p>'+esc(current.stale?'Stale: no current recommendation.':chosen?.response??(r.selected==='none'?'No suitable candidate; hand back to the Keeper.':'Unavailable'))+'</p><span class="pill '+(r.grade?.expected_region?'':'bad')+'">'+esc(r.grade?.expected_region?'Within the predeclared diagnostic expectation':'Outside the predeclared expectation / unavailable')+'</span><span class="pill">Host-excluded options: '+esc(r.excluded_options.join(', ')||'none')+'</span>'+(speech&&current.arm==='full'&&current.repeat===1&&!current.stale?'<h3>Tool-enabled author sample from this exact choice</h3><blockquote>'+esc(speech.text)+'</blockquote>':'')+'</article><article class="card wide"><h3>Independent scores (0–4) and Choice probabilities</h3><p class="muted">Choice did not read these scores. The host does not combine them into a personality total.</p><div style="overflow-x:auto"><table><thead><tr><th>Candidate</th><th>Personality fit</th><th>History fit</th><th>Context fit</th><th>Choice probability</th></tr></thead><tbody>'+rows+'</tbody></table></div></article>';
 el('raw').textContent=JSON.stringify({view:current,record:r},null,2);
}
render();
</script></html>`;
await fs.writeFile(path.join(dir,'prototype.html'),html);
console.log(JSON.stringify({html:path.join(dir,'prototype.html'),bytes:Buffer.byteLength(html),records:data.records.length,includes_key:false}));
