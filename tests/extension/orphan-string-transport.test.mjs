import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Type} from 'typebox';import {normalizeToolArgumentSyntax} from '../../runtime/tool-argument-syntax.ts';
import {normalizeTurnPacketArguments,turnPacket} from '../../runtime/turn-packet-prototype.ts';

test('the retained native MiniMax packet decodes its three exact string leaves before ordinary validation',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/minimax-orphan-string-20261019.json',import.meta.url)));
 const before=JSON.stringify(fixture.args),decoded=normalizeTurnPacketArguments(fixture.args);
 assert.equal(decoded.textRepairs,3);assert.equal(decoded.repairs,0);
 const packet=turnPacket(JSON.stringify(decoded.args));
 const original=fixture.args.interactions[0].content[0].new.items;
 assert.deepEqual(packet.interactions[0].content[0].new.items,original.map(row=>({label:row.$text.slice('label>'.length)})));
 assert.equal(JSON.stringify(fixture.args),before,'the original trace is immutable');
 assert.deepEqual(packet.commands,fixture.args.commands);
});

test('orphan recovery uses a unique schema field rather than a name or language list',()=>{
 const schema=Type.Object({topic:Type.String({minLength:1,maxLength:40})},{additionalProperties:false});
 const input={topic:'',$text:'topic>  Literal value  '};
 const decoded=normalizeToolArgumentSyntax(schema,input,{partialTransport:true});
 assert.equal(decoded.textRepairs,1);assert.deepEqual(decoded.args,{topic:'  Literal value  '});
 assert.deepEqual(normalizeToolArgumentSyntax(schema,input).args,input);
});

test('conflicts, unknown fields, wrong prefixes and bounds remain invalid rather than guessed',()=>{
 const schema=Type.Object({topic:Type.String({minLength:1,maxLength:8})},{additionalProperties:false});
 for(const input of [{topic:'Known',$text:'topic>Other'},{topic:'',$text:'other>Value'},{$text:'topic>Value'},
  {topic:'',$text:'topic>'},{topic:'',$text:'topic>123456789'},{topic:'',$text:'topic>Value',extra:true}]){
  const result=normalizeToolArgumentSyntax(schema,input,{partialTransport:true});assert.deepEqual(result.args,input);assert.ok(!result.textRepairs);
 }
 const ambiguous=Type.Object({topic:Type.String(),other:Type.Optional(Type.String())},{additionalProperties:false});
 const input={topic:'',$text:'topic>Value'};assert.deepEqual(normalizeToolArgumentSyntax(ambiguous,input,{partialTransport:true}).args,input);
});

test('a lone {$text} where a string is declared is that string; any other shape is left as sent (§264.36)',()=>{
 const schema=Type.Object({weapons:Type.Array(Type.Union([Type.String(),Type.Object({name:Type.String(),profile:Type.String()},{additionalProperties:false})]))});
 const result=normalizeToolArgumentSyntax(schema,{weapons:[{$text:'.38 Automatic'},{name:'Rifle',profile:'.30-06 Bolt-Action Rifle'}]},{nativeValidation:true});
 assert.deepEqual(result.args,{weapons:['.38 Automatic',{name:'Rifle',profile:'.30-06 Bolt-Action Rifle'}]});assert.equal(result.textRepairs,1);
 const extra={weapons:[{$text:'.38 Automatic',name:'x'}]};assert.deepEqual(normalizeToolArgumentSyntax(schema,extra).args,extra);
});
