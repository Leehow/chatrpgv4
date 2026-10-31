/**
 * Ready answers (on by default since 1030g/h, `PI_COC_KP_READY_ANSWERS=0` turns them off): the host hands the Keeper the answers it can
 * compute from committed state, so the Keeper stops re-deriving them (1029 analysis: about a quarter of MiniMax Keeper
 * thinking went to reference issuance and field format, more to presence, holdings and clock arithmetic). Read on each
 * call, so a test can switch it per case.
 */
export const readyAnswers=():boolean=>process.env.PI_COC_KP_READY_ANSWERS!=='0';
/**
 * Field defaults (on by default since 1030g/h, `PI_COC_KP_FIELD_DEFAULTS=0` turns them off; with ready answers): the ready block also carries the minimal
 * field table of the packet commands this turn can use, and what the host fills when they are left out (1029z: field and
 * reference format was still 21% of MiniMax Keeper thinking with ready answers on, in every turn).
 */
export const fieldDefaults=():boolean=>process.env.PI_COC_KP_FIELD_DEFAULTS!=='0';
/**
 * The field index, generated from the packet schema itself so it never leaves a command out (1030c/d review: the hand-written
 * table listed seven commands and no route for objects and documents). One row per command, interaction and content
 * variant: its discriminator, then its fields, `?` for optional. Names only; the schema stays the authority.
 */
const DISCRIMINATORS = ['kind', 'action', 'act', 'predicate'];
function variantsOf(schema: Row | undefined): Row[] {
  if (!schema) return [];
  // An object whose own anyOf names which fields must appear (time, relationship) is one variant, not a union.
  if (schema.type === 'object') return [schema];
  if (Array.isArray(schema.anyOf)) return schema.anyOf.flatMap((branch: Row) => variantsOf(branch));
  if (Array.isArray(schema.oneOf)) return schema.oneOf.flatMap((branch: Row) => variantsOf(branch));
  if (schema.type === 'array') return variantsOf(schema.items);
  return [];
}
function labelOf(variant: Row): string {
  const props = row(variant.properties);
  return DISCRIMINATORS.flatMap(key => {
    const value = row(props[key]).const ?? row(props[key]).enum;
    return value === undefined ? [] : [Array.isArray(value) ? value.join('|') : String(value)];
  }).join('.');
}
function fieldsOf(variant: Row): string {
  const required = new Set(Array.isArray(variant.required) ? variant.required : []);
  const listed = Object.keys(row(variant.properties)).filter(key => !DISCRIMINATORS.includes(key)).map(key => required.has(key) ? key : `${key}?`).join(', ');
  // The object's own anyOf of required fields: at least one of them.
  const oneOf = (Array.isArray(variant.anyOf) ? variant.anyOf : []).flatMap((branch: Row) => Array.isArray(branch.required) ? [branch.required.join('+')] : []);
  return oneOf.length ? `${listed}; at least one of ${oneOf.join('|')}` : listed;
}
export function schemaFieldIndex(packet: Row): Row {
  const props = row(packet.properties), index: Row = {};
  for (const variant of variantsOf(props.commands)) index[`commands ${labelOf(variant)}`] = fieldsOf(variant);
  const interactions = variantsOf(props.interactions);
  for (const variant of interactions) index[`interactions ${labelOf(variant)}`] = fieldsOf(variant);
  const content = interactions.flatMap(variant => variantsOf(row(row(variant.properties).content)));
  const seen = new Set<string>();
  for (const item of content) {
    const constructors = variantsOf(row(row(item.properties).new));
    for (const entry of constructors.length ? constructors : [item]) {
      const key = constructors.length ? `content new ${labelOf(entry)}` : `content ${Object.keys(row(entry.properties)).filter(name => name !== 'strategy').join('|')}`;
      if (!seen.has(key)) { seen.add(key); index[key] = fieldsOf(entry); }
    }
  }
  for (const variant of variantsOf(props.reveal)) index[`reveal ${Object.keys(row(variant.properties)).join('|')}`] = fieldsOf(variant);
  return index;
}
/** What the packet cannot do, said where the index is read. */
export const APPLY_ROUTE = 'Objects and documents are not packet commands: taking, giving, buying, defining an item, and writing or showing a '
 + 'paper go through apply (define / object, document write or append), read its result, then output. Rolls go through resolve first.';
export const HOST_FILLS='Left out, the host fills: version 4; walk_on.to here; content strategy (refer when already told, else new); '
 +'channel speech; a listed route\'s travel minutes. Lists are JSON arrays.';

import {TURN_PACKET_PARAMETERS} from './turn-packet-prototype.ts';

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
  ...(fieldDefaults()?{fields:{...schemaFieldIndex(TURN_PACKET_PARAMETERS),apply_route:APPLY_ROUTE,host_fills:HOST_FILLS}}:{})};
}
