// Deterministic provider substitute for host-interface tests, never live-play evidence.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const packet = JSON.parse(readFileSync(join(process.cwd(), 'task.json'), 'utf8'));
if (JSON.stringify(packet).includes('PRIVATE_CULPRIT')) throw Error('Private material reached the writer');
const material = packet.materials.find(row => row.name === 'cold room');
if (!material) throw Error('The selected portrayal was not materialized');
if(process.env.PI_COC_TEST_EXPECT_SOURCE==='1'&&!packet.materials.some(row=>row.authority==='reference_only'&&row.text.includes('You are in the office.')))
  throw Error('The original delivered source was not materialized');
const text = 'The room is chilly.';
const badOnce=process.env.PI_COC_TEST_BAD_ONCE==='1'&&!existsSync('fixture-once');
if(badOnce)writeFileSync('fixture-once','attempted');
const bad=process.env.PI_COC_TEST_BAD_COVERAGE==='1'||badOnce;
writeFileSync('draft.json', JSON.stringify({version: 1, text, coverage: [{name: bad?'unissued material':material.name, quote: text}]}));
if(!bad) {
  const checked=spawnSync(packet.commands.check,{shell:true,encoding:'utf8'});
  if(checked.status!==0)throw Error(checked.stderr);
}
// Report the model the host launched this author on, as a real child's message_end would.
const launched = String(process.env.PI_COC_TEST_WRITER_ACTUAL ?? process.env.PI_COC_FINAL_OUTPUT_MODEL ?? '');
const slash = launched.indexOf('/');
process.stdout.write(JSON.stringify({type: 'message_end', message: {role: 'assistant', provider: launched.slice(0, slash), model: launched.slice(slash + 1), stopReason: 'stop', content: []}}) + '\n');
