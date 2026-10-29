/**
 * Ready answers (experiment, `PI_COC_KP_READY_ANSWERS=1`, off by default): the host hands the Keeper the answers it can
 * compute from committed state, so the Keeper stops re-deriving them (1029 analysis: about a quarter of MiniMax Keeper
 * thinking went to reference issuance and field format, more to presence, holdings and clock arithmetic). Read on each
 * call, so a test can switch it per case.
 */
export const readyAnswers=():boolean=>process.env.PI_COC_KP_READY_ANSWERS==='1';
/**
 * Field defaults (experiment, `PI_COC_KP_FIELD_DEFAULTS=1`, with ready answers): the ready block also carries the minimal
 * field table of the packet commands this turn can use, and what the host fills when they are left out (1029z: field and
 * reference format was still 21% of MiniMax Keeper thinking with ready answers on, in every turn).
 */
export const fieldDefaults=():boolean=>process.env.PI_COC_KP_FIELD_DEFAULTS==='1';
/** The commands any turn may use: required fields first, `?` optional; the schema stays the authority. */
export const FIELDS_ALWAYS:Readonly<Record<string,string>>={
 'place.move':'to; via? or travel_band? only for a route not listed under travel; with?/leave? companions',
 'place.observe':'facts[] (short); people[]? refs',
 time:'reason; one of band | minutes (extra activity only; a move already counts its journey)',
 walk_on:'slot new_1..new_4, label, reason; book? only for the book\'s own person; to? (default here)',
 clue:'clue, how; summary? only for a clue the book does not have; from? who told it',
 mood:'actor npc_N|new_N, mood',
 scene:'service, crowd (optional: left out is unknown)'};
/** The commands a turn with people in it may use. */
export const FIELDS_PEOPLE:Readonly<Record<string,string>>={
 interactions:'actor, to[], act answer|ask|offer|clarify|report|warn + content[1..8]; greet|refuse|acknowledge content?; silent {actor,act}',
 content:'{fact_ref} | {source_ref} | {new:{predicate:"meaning",meaning<=60}} | {new:{predicate:"knowledge_status",topic:issued ref|"player_input",status:unknown|uncertain|withheld|nothing_more}}',
 relationship:'actor, toward; only the changed fields among disposition, trust, fear, pressure, control',
 npc:'actor npc_N|new_N, to here|away|issued place, reason'};
export const HOST_FILLS='Left out, the host fills: version 4; walk_on.to here; content strategy (refer when already told, else new); '
 +'channel speech; a listed route\'s travel minutes. Lists are JSON arrays.';

type Row=Record<string,any>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(row):[];
const text=(value:unknown):string|undefined=>typeof value==='string'&&value.trim()?value:undefined;

export const READY_NOTE='Computed by the host from committed state; authoritative. Use these answers as given; do not re-derive them '
 +'from other sections. They settle nothing new and grant no action the player did not choose.';
/** One line on newcomers and reference shapes: what the reference rules are, not how to judge the scene. */
export const READY_REFS='Reference people by these npc_N. Anyone else who acts or speaks here walks on as new_1..new_4 in this packet; '
 +'mood, name, npc and relationship commands may use that new_N too: the host seats the newcomer first. Lists are JSON arrays.';

/** The clock as one string: the dated form when the book pins a date, else day N HH:MM. */
function clockText(clock:Row):string|undefined {
 if(text(clock.at))return `${clock.at} (${clock.day_part})`;
 if(clock.hh!==undefined)return `day ${clock.day} ${clock.hh}:${clock.mm} (${clock.day_part})`;
 return undefined;
}

/**
 * The block, from the capsule the Keeper is sent this request. `startMinutes` is the clock at the turn's first request,
 * when known, so time already charged this input is a subtraction, not a reading of receipts.
 */
export function readyBlock(capsule:Row,startMinutes?:number):Row {
 const where=row(capsule.where),clock=row(where.clock),present=rows(capsule.present);
 const here=new Set(present.map(person=>person.ref).filter(Boolean));
 const person=(p:Row)=>({ref:p.ref,called:p.display_name??p.name,...(p.name_known===false?{name_known:false}:{}),...(p.company?{with_party:true}:{})});
 const elsewhere=rows(row(capsule.npc_references).people).filter(p=>p.ref&&!here.has(p.ref)).slice(0,12)
  .map(p=>({...person(p),...(text(p.recorded_at)?{at:p.recorded_at}:{})}));
 const minutes=typeof clock.minutes==='number'?clock.minutes:undefined;
 const charged=minutes!==undefined&&startMinutes!==undefined&&minutes>=startMinutes?minutes-startMinutes:undefined;
 const holders=rows(row(capsule.public_inventory).holders).map(h=>({holder:h.name,items:rows(h.items).map(i=>i.quantity>1?`${i.name} x${i.quantity}`:i.name)}))
  .filter(h=>h.items.length);
 const documents=rows(row(capsule.documents_in_reach).rows).map(d=>({name:d.name,holder:d.holder,reach:d.reach,...(d.open?{open:true}:{})}));
 const checks=rows(row(capsule.checks_this_turn).rows).map(c=>({skill:c.skill,...(c.goal?{goal:c.goal}:{}),passed:c.passed,level:c.level}));
 const exits=rows(where.exits).filter(e=>typeof e.travel_minutes==='number').map(e=>({to:e.display_name??e.to,travel_minutes:e.travel_minutes}));
 return {note:READY_NOTE,refs:READY_REFS,
  people_here:present.filter(p=>p.ref&&p.kind!=='creature').map(person),
  ...(elsewhere.length?{known_elsewhere:elsewhere}:{}),
  place:where.scene??null,
  clock:{now:clockText(clock)??null,...(charged!==undefined?{charged_this_input_minutes:charged}:{})},
  ...(exits.length?{travel:exits}:{}),
  ...(holders.length?{holdings:holders}:{}),
  ...(documents.length?{documents}:{}),
  ...(checks.length?{checks_settled:checks}:{}),
  ...(fieldDefaults()?{fields:{...FIELDS_ALWAYS,...(present.some(p=>p.ref&&p.kind!=='creature')?FIELDS_PEOPLE:{}),host_fills:HOST_FILLS}}:{})};
}
