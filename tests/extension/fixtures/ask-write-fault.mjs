// Fail one filesystem publication boundary in a real kernel; never synthesizes game behavior.
import fs from 'node:fs/promises';
import {existsSync,readFileSync,unlinkSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const rename=fs.rename;
let asked=false;
fs.rename=async(source,target)=>{
  const armed=process.env.PI_COC_TEST_ASK_FAULT;
  if(armed&&existsSync(armed)&&String(target).endsWith('/turn.json')){
    const value=JSON.parse(readFileSync(source,'utf8'));
    if(value.state==='asked'){
      if(process.env.PI_COC_TEST_ASK_FAULT_PHASE==='after_cursor'){const result=await rename(source,target);asked=true;return result;}
      unlinkSync(armed);throw Error('Injected failure before the durable asked cursor');
    }
  }
  if(armed&&existsSync(armed)&&asked&&String(target).endsWith('/turns/0001.json')){
    unlinkSync(armed);throw Error('Injected failure after the durable asked cursor');
  }
  return rename(source,target);
};
syncBuiltinESMExports();
