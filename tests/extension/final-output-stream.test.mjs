import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtifactTextStream} from '../../runtime/final-output-stream.ts';

test('artifact text is decoded before coverage arrives, without exposing protocol or split Unicode',()=>{
  const stream=new ArtifactTextStream();
  assert.equal(stream.push('{"version":1,"text":"The \\"'),'The "');
  assert.equal(stream.push('room\\" is cold.\\n\\uD83D'),'room" is cold.\n');
  assert.equal(stream.push('\\uDE00"'),'😀');
  assert.equal(stream.push(',"coverage":[{"name":"room","quote":"cold"}]}'),'');
  assert.equal(stream.finish().text,'The "room" is cold.\n😀');
});

test('every protocol boundary preserves escaped text and nested coverage without interpreting metadata as prose',()=>{
  const raw='{"version":1,"text":"A \\"word\\".\\n\\uD83D\\uDE00","coverage":[{"name":"note","quote":"word"}]}';
  for(let cut=0;cut<=raw.length;cut++){
    const stream=new ArtifactTextStream();
    const text=stream.push(raw.slice(0,cut))+stream.push(raw.slice(cut));
    assert.equal(text,'A "word".\n😀');
    assert.equal(stream.finish().text,text);
  }
});

test('duplicate fields and incomplete metadata cannot become a completed artifact',()=>{
  for(const raw of ['{"version":1,"text":"Visible","coverage":[],"text":"replacement"}',
    '{"version":1,"text":"Visible","coverage":']){
    const stream=new ArtifactTextStream();
    assert.equal(stream.push(raw),'Visible');
    assert.throws(()=>stream.finish());
  }
});

test('one trailing closing brace after a complete valid artifact preserves public bytes and one record',()=>{
  const value={version:1,record:{event:{name:'fixture',summary:'PRIVATE { nested } "quoted" account.'}},
    text:'Public } reply with "quotes" and 😀.',coverage:[{name:'reply',quote:'Public'}]};
  for(const suffix of ['','}',' \n } \t']){
    const raw=JSON.stringify(value)+suffix;
    for(let cut=0;cut<=raw.length;cut++){
      const records=[],stream=new ArtifactTextStream(record=>records.push(record));
      const exposed=stream.push(raw.slice(0,cut))+stream.push(raw.slice(cut));
      assert.equal(exposed,value.text);
      assert.deepEqual(stream.finish(),value);
      assert.deepEqual(records,[value.record]);
    }
  }
});

test('the single-brace exception does not repair other tails, duplicate keys or invalid roots',()=>{
  const valid='{"version":1,"record":{},"text":"Visible","coverage":[]}';
  const invalid=[...['}}',',','word','{}','\n```','}word','}{}',']'].map(suffix=>valid+suffix),
    '```json\n'+valid+'\n```}', 'note '+valid+'}',
    '{"version":1,"record":{},"text":"Visible","text":"Visible"}}',
    '{"version":1,"record":{},"text":"Visible","unknown":null}}',
    '{"version":1,"record":{},"text":"Visible","coverage":[',
    '{"version":1,"record":{},"text":"Visible"'];
  for(const raw of invalid){const stream=new ArtifactTextStream(()=>{});assert.throws(()=>{stream.push(raw);stream.finish();});}
});

test('invalid optional coverage containers cannot interrupt a valid public body or change private record validation',()=>{
  for(const coverage of [null,{},'invalid',Array.from({length:129},()=>({name:'note',quote:'Visible'}))]){
    const records=[],stream=new ArtifactTextStream(record=>records.push(record));
    const value={version:1,record:{effects:[]},text:'Visible',coverage};
    assert.equal(stream.push(JSON.stringify(value)),value.text);
    assert.deepEqual(stream.finish(),{...value,coverage:[]});assert.deepEqual(records,[value.record]);
  }
  const stream=new ArtifactTextStream(()=>{});
  assert.throws(()=>stream.push(JSON.stringify({version:1,record:{effects:{}},text:'Must stay private.',coverage:null})));
});

test('private records decode across every boundary and reject invalid shapes before exposing text',()=>{
  const value={version:1,record:{event:{name:'office',summary:'Private { nested } text with "quotes".'}},text:'Public reply.'};
  const raw=JSON.stringify(value);
  for(let cut=0;cut<=raw.length;cut++){
    const records=[],stream=new ArtifactTextStream(record=>records.push(record));
    assert.equal(stream.push(raw.slice(0,cut))+stream.push(raw.slice(cut)),value.text);
    assert.deepEqual(records,[value.record]);
    assert.equal(stream.finish().text,value.text);
  }
  for(const record of [{effects:{}},{event:[]},{scope:'unknown'},{choice:[]},{scope:'reference',event:{}}]){
    const stream=new ArtifactTextStream(()=>{});
    assert.throws(()=>stream.push(JSON.stringify({version:1,record,text:'Must not appear.'})));
  }
});

test('native public prose streams without a JSON wrapper at every marker boundary',()=>{
  for(const marker of ['{{public}}','{{reference}}'])for(let cut=0;cut<=marker.length+10;cut++){
    const records=[],stream=new ArtifactTextStream(record=>records.push(record));
    const raw=marker+'A "quoted" line.\nSecond line.';
    assert.equal(stream.push(raw.slice(0,cut))+stream.push(raw.slice(cut)),'A "quoted" line.\nSecond line.');
    assert.equal(stream.finish().text,'A "quoted" line.\nSecond line.');
    assert.deepEqual(records,marker==='{{reference}}'?[{scope:'reference'}]:[]);
  }
});

test('delivery recovery retains complete frames when a crash tears the final append',async()=>{
  const {mkdtempSync,readFileSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {DeliveryJournal}=await import('../../runtime/final-output-stream.ts');
  const dir=mkdtempSync(join(tmpdir(),'delivery-journal-'));
  try {
    const file=join(dir,'delivery.jsonl'),binding={campaign:'c',turn:1,worldline:'main',loop:0,run:'r',input_revision:'i',delivery_id:'d'};
    const initial=new DeliveryJournal(file,binding,()=>{});
    initial.write('start');initial.write('delta',{delta:'Already visible.'});
    writeFileSync(file,'{"version":1,"event":"delta"',{flag:'a'});
    const replay=[],recovered=new DeliveryJournal(file,binding,frame=>replay.push(frame));
    recovered.replay();recovered.write('end',{status:'interrupted'});
    assert.equal(replay[1].delta,'Already visible.');
    assert.equal(readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).length,3);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
