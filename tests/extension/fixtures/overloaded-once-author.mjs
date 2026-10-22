// Controlled transient provider refusal at the real isolated-author transport seam, then an ordinary answer; never gameplay evidence.
import {existsSync,writeFileSync} from 'node:fs';
const message=existsSync('overloaded.marker')
  ?{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'You wait beside the desk while Knott reads.'}]}
  :{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'error',errorMessage:'529 overloaded',content:[]};
if(!existsSync('overloaded.marker'))writeFileSync('overloaded.marker','1');
process.stdout.write(JSON.stringify({type:'message_end',message})+'\n');
