/** Contract §260.3/§260.5: where the author's attention goes, from public settled data only. */
type Row=Record<string,any>;
export type BearingTier='focus'|'engaged'|'background';
export type Disposition='hostile'|'unfriendly'|'neutral'|'friendly'|'ally';
export interface Bearing {tier:BearingTier;needs_introduction?:true;toward?:Array<{ref:string;disposition:Disposition}>}

/** §260.5: §258 P1's shown `public` disposition; before it, the directed affinity by a closed enum map. */
const AFFINITY:Record<string,Disposition>={hostile:'hostile',guarded:'unfriendly',neutral:'neutral',friendly:'friendly'};
const DISPOSITIONS=new Set<string>(['hostile','unfriendly','neutral','friendly','ally']);
const shown=(relation:Row):Disposition|undefined=>DISPOSITIONS.has(relation?.public)?relation.public:AFFINITY[relation?.affinity];
/** Acts whose response carries the moment; a greeting, a nod or silence engages without taking it. */
const ENGAGING_ONLY=new Set(['greet','acknowledge','silent']);

/**
 * Inputs are what the author may already see: presence, the selected responses, settled npc outcomes, attitude
 * changes the packet settled, the people projection's directed relationships and this turn's first sight. Hidden
 * NPC state is not an input, so it cannot move a tier.
 */
export function npcBearing(input:{presence:readonly Row[];responses:readonly Row[];outcomes:readonly Row[];
  relationshipChanges?:readonly Row[];people:readonly Row[];firstSight?:readonly Row[]}):Map<string,Bearing> {
 const responded=new Map<string,boolean>();
 for(const response of input.responses)if(typeof response?.actor==='string')
  responded.set(response.actor,(responded.get(response.actor)??false)||!ENGAGING_ONLY.has(response.act));
 const outcome=new Set(input.outcomes.filter(row=>row?.kind==='npc'&&row.status==='changed'&&typeof row.actor==='string').map(row=>row.actor));
 const attitude=new Set((input.relationshipChanges??[]).map(row=>row?.actor).filter((ref):ref is string=>typeof ref==='string'));
 const introduced=new Set((input.firstSight??[]).map(row=>row?.ref).filter((ref):ref is string=>typeof ref==='string'));
 const people=new Map(input.people.filter(row=>typeof row?.ref==='string').map(row=>[row.ref,row]));
 const result=new Map<string,Bearing>();
 for(const person of input.presence){
  const ref=person?.ref;if(typeof ref!=='string')continue;
  const intro=introduced.has(ref),acts=responded.has(ref);
  const tier:BearingTier=responded.get(ref)||outcome.has(ref)||attitude.has(ref)||intro&&acts?'focus':acts?'engaged':'background';
  const toward=(Array.isArray(people.get(ref)?.relationships)?people.get(ref)!.relationships:[])
   .filter((relation:Row)=>typeof relation?.toward==='string'&&/^investigator_[1-9][0-9]*$/.test(relation.toward)&&shown(relation))
   .map((relation:Row)=>({ref:relation.toward,disposition:shown(relation)!}));
  result.set(ref,{tier,...(intro?{needs_introduction:true as const}:{}),...(toward.length?{toward}:{})});
 }
 return result;
}

/** Writes each bearing beside its presence entry; returns the telemetry rows of §260.8. */
export function attachBearing(presence:Row[],bearing:Map<string,Bearing>,responses:readonly Row[]):Row[] {
 const beats=new Set(responses.filter(row=>typeof row?.beat==='string').map(row=>row.actor));
 const rows:Row[]=[];
 for(const person of presence){
  const value=bearing.get(person?.ref);if(!value)continue;
  person.bearing=value;
  rows.push({ref:person.ref,tier:value.tier,...(value.needs_introduction?{needs_introduction:true}:{}),...(beats.has(person.ref)?{beat:true}:{})});
 }
 return rows;
}
