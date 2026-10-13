/** Delay the existing campaign writes until every dependent effect and semantic event validates. */
import {join,dirname} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import type {JsonValue,ReadonlyJson} from '../json.js';
import {CampaignWriter} from '../write/store.js';
import {clone,string,type Row} from '../read/values.js';

export class StagedCampaignWriter extends CampaignWriter {
  private pending=new Map<string,{value?:any;remove?:boolean;save?:string}>();
  private staging=true;
  private textFiles=new Map<string,string>();
  stageText(path:string,text:string):void{this.textFiles.set(path,text);}
  override async read(name:string):Promise<Row>{return this.pending.has(name)?clone(this.pending.get(name)!.value):super.read(name);}
  override async write(name:string,value:Row):Promise<void>{if(!this.staging)return super.write(name,value);this.pending.set(name,{value:clone(value)});}
  override async readSave(name:string):Promise<JsonValue|null>{const entry=this.pending.get(join('save',name));return entry?entry.remove?null:clone(entry.value):super.readSave(name);}
  override async writeSave(name:string,value:ReadonlyJson):Promise<void>{
    if(!this.staging)return super.writeSave(name,value);
    await super.readSave(name);this.pending.set(join('save',name),{value:clone(value),save:name});
  }
  override async removeSave(name:string):Promise<void>{
    if(!this.staging)return super.removeSave(name);
    await super.readSave(name);this.pending.set(join('save',name),{remove:true,save:name});
  }
  override async saveExists(name:string):Promise<boolean>{const entry=this.pending.get(join('save',name));return entry?!entry.remove:super.saveExists(name);}
  override async party():Promise<Row[]>{
    const sheets=await super.party(),ids=new Set(sheets.map(sheet=>string(sheet.id)));
    for(const [name,entry] of this.pending)if(name.startsWith('party/')&&!ids.has(string(entry.value?.id)))sheets.push(clone(entry.value));
    return sheets;
  }
  async commit():Promise<void>{
    for(const [name,entry] of this.pending)if(entry.save){
      if(entry.remove)await super.removeSave(entry.save);else await super.writeSave(entry.save,entry.value);
    }else await super.write(name,entry.value);
    for(const [path,text] of this.textFiles){await mkdir(dirname(path),{recursive:true});await writeFile(path,text,'utf8');}
    this.pending.clear();this.textFiles.clear();this.staging=false;
  }
}
