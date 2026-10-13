/** Record actual Node collection and outcomes, including tests without temporary fixtures. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export default async function* reporter(events){
  const run=process.env.COC_TEST_STORAGE_RUN,policy=JSON.parse(readFileSync(process.env.COC_TEST_STORAGE_POLICY??join(root,'tests/test-storage-policy.json'),'utf8'));
  const map=new Map();if(existsSync(join(root,'tests/ts-migration-manifest.json'))){const manifest=JSON.parse(readFileSync(join(root,'tests/ts-migration-manifest.json'),'utf8'));for(const file of manifest.files)for(const entry of file.cases)if(entry.counterpart)map.set(`${resolve(root,entry.counterpart.file)}::${entry.counterpart.name}`,`${file.source}::${entry.name}`);}
  const report={collected:[],reports:[]},seen=new Set();
  for await(const event of events){const data=event.data;if(!data.file||!data.name||data.name===data.file||data.name===relative(process.cwd(),data.file))continue;
    const bare=data.name.replace(/ \[\d+\]$/,''),mapped=map.get(`${resolve(data.file)}::${bare}`),nodeid=mapped?(bare===data.name?mapped:mapped+data.name.slice(bare.length)):`${relative(process.cwd(),resolve(data.file))}::${data.name}`;
    const named=nodeid.split('[',1)[0].trimEnd(),storage=policy.disk_files.includes(named.split('::',1)[0])||policy.disk_tests.includes(named)?'disk':'ordinary';
    if(event.type==='test:enqueue'&&!seen.has(nodeid)){seen.add(nodeid);report.collected.push({nodeid,storage});}
    if(event.type==='test:pass'||event.type==='test:fail')report.reports.push({nodeid,phase:'call',outcome:data.skip?'skipped':event.type==='test:pass'?'passed':'failed',seconds:(data.details?.duration_ms??0)/1000});
  }
  writeFileSync(join(run,'storage-events.json'),JSON.stringify(report,null,2)+'\n');
}
