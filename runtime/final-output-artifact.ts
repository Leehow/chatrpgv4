/** Structural artifact validation only; coverage is evidence, never semantic authorization. */
export interface DeliveryCoverage {name: string; start: number; end: number}
export interface DeliveryArtifact {version: 1; text: string; coverage: DeliveryCoverage[]}
/** The delivery owner has already filtered this DTO to permitted public material. */
export function deliveryMaterialNames(materials:unknown):string[]{
  return Array.isArray(materials)?materials.flatMap(material=>material&&typeof material.name==='string'
    ?[material.name,...(typeof material.event_ref==='string'&&material.name.startsWith(material.event_ref+'/')?[material.name.slice(material.event_ref.length+1)]:[])]:[]):[];
}
export function validateDeliveryArtifact(value: unknown, names: readonly string[], required: readonly string[]): DeliveryArtifact {
  const artifact = value as DeliveryArtifact;
  if (!artifact || artifact.version !== 1 || typeof artifact.text !== 'string' || !artifact.text.trim()
    || Buffer.byteLength(artifact.text, 'utf8') > 64000 || !Array.isArray(artifact.coverage) || artifact.coverage.length > 128
    || Object.keys(artifact).some(key => !['version', 'text', 'coverage'].includes(key))) throw Error('Invalid final-output artifact');
  const coverage:DeliveryCoverage[]=[];
  for (const [index,entry] of artifact.coverage.entries()) {
    let span=entry;
    const quoted=entry as unknown as {name:string;quote?:string;occurrence?:number};
    if (quoted.quote!==undefined) {
      if (typeof quoted.quote!=='string'||!quoted.quote.trim()||Object.keys(entry).some(k=>!['name','quote','occurrence'].includes(k))) throw Error('Invalid coverage quotation');
      const occurrence=quoted.occurrence??0;
      if(!Number.isSafeInteger(occurrence)||occurrence<0||occurrence>128)throw Error('Invalid coverage occurrence');
      let start=-1,from=0;
      for(let at=0;at<=occurrence;at++){start=artifact.text.indexOf(quoted.quote,from);if(start<0)throw Error(`Coverage quotation is absent at coverage[${index}].quote; select an exact substring of text`);from=start+quoted.quote.length;}
      span={name:quoted.name,start,end:start+quoted.quote.length};
    }
    if (!span || Object.keys(span).some(key => !['name', 'start', 'end'].includes(key)) || !names.includes(span.name)
      || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start
      || span.end > artifact.text.length || !artifact.text.slice(span.start, span.end).trim()) throw Error('Invalid material coverage span');
    coverage.push(span);
  }
  if (required.some(name => !coverage.some(span => span.name === name))) throw Error('Required material has no coverage declaration');
  return {version:1,text:artifact.text,coverage};
}
