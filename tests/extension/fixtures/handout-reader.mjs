/**
 * A stand-in for the zero-tool Pi child that reads a pictured handout (contract §155).
 *
 * It is launched exactly as the real child is -- through the worker's node launcher, with the child's own argv
 * (`--tools ""`, `--mode json`, the picture as `@image.png` before the `--` that ends the options) and the attempt
 * directory as its working directory -- and answers the way pi's JSON mode does: assistant events, one JSON object
 * per line on stdout, the text arriving in deltas. It records what it was launched with and which picture it saw,
 * and decides nothing about language beyond the brief's tag (or `keep` when told to).
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2),flag=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const stop=args.indexOf('--'),brief=args[args.length-1],attachments=args.slice(0,stop<0?args.length:stop).filter(arg=>arg.startsWith('@'));
const tag=(/Play language: (\S+)/.exec(brief)||[])[1];
const picture=attachments[0]?readFileSync(attachments[0].slice(1)):Buffer.alloc(0);
writeFileSync('launch-argv.json',JSON.stringify({model:flag('--model'),thinking:flag('--thinking'),tools:flag('--tools'),mode:flag('--mode'),
  attachments,after_double_dash:stop>=0&&stop===args.length-2,brief,seen_sha256:createHash('sha256').update(picture).digest('hex')}));
const reply=process.env.HANDOUT_FIXTURE_KEEP==='1'?'keep'
  :`translate\n[${tag}] PRINTED HEADLINE\n\n[${tag}] Printed body, line one.\n\n[${tag}] Printed body, line two […]`;
const say=event=>process.stdout.write(JSON.stringify(event)+'\n');
say({type:'agent_start'});
say({type:'message_start',message:{role:'assistant',content:[]}});
for(let at=0;at<reply.length;at+=11){
  say({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:reply.slice(at,at+11)}});
  await new Promise(resolve=>setTimeout(resolve,60));
}
say({type:'message_end',message:{role:'assistant',content:[{type:'text',text:reply}],stopReason:'stop'}});
say({type:'agent_end'});
