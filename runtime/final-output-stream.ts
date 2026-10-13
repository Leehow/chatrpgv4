import {appendFileSync,existsSync,readFileSync,truncateSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export interface DeliveryFrame {
  version: 1;
  campaign: string;
  turn: number;
  worldline: string;
  loop: number;
  run: string;
  input_revision: string;
  delivery_id: string;
  attempt_id: string;
  sequence: number;
  event: 'start' | 'delta' | 'end' | 'error';
  error?: {code:'generation_failed'};
  delta?: string;
  status?: 'streaming' | 'finalizing' | 'completed' | 'interrupted' | 'publication_pending';
  timestamp: number;
  speakers?: Array<{name:string;who:Record<string,unknown>}>;
}

/** Only newline-terminated records were committed before exposure. */
export function readDeliveryFrames(path:string):DeliveryFrame[] {
  const content=readFileSync(path,'utf8');
  return content.slice(0,content.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(line=>JSON.parse(line));
}

/** The existing delivery attempt owns its durable, replayable public stream. */
export class DeliveryJournal {
  readonly frames: DeliveryFrame[];
  private binding: Omit<DeliveryFrame,'event'|'sequence'|'timestamp'|'delta'|'status'>;
  private path: string;
  private emit: (frame: DeliveryFrame) => void;
  constructor(path: string, binding: Omit<DeliveryFrame,'version'|'event'|'sequence'|'timestamp'|'attempt_id'|'delta'|'status'>,
    emit: (frame: DeliveryFrame) => void) {
    this.path=path;this.emit=emit;
    this.frames = existsSync(path) ? readDeliveryFrames(path) : [];
    for(const [index,frame] of this.frames.entries()){
      if(frame.version!==1||frame.sequence!==index+1||frame.campaign!==binding.campaign||frame.turn!==binding.turn
        ||frame.worldline!==binding.worldline||frame.loop!==binding.loop||frame.delivery_id!==binding.delivery_id
        ||frame.input_revision!==binding.input_revision||!['start','delta','end','error'].includes(frame.event))
        throw new Error('Invalid persisted final delivery stream');
    }
    const saved=this.frames[0];
    if(existsSync(path)){
      const content=readFileSync(path,'utf8'),end=content.lastIndexOf('\n')+1;
      if(end<content.length){
        writeFileSync(`${path}.torn-${randomUUID()}`,content.slice(end),{flag:'wx',flush:true});
        truncateSync(path,Buffer.byteLength(content.slice(0,end),'utf8'));
      }
    }
    this.binding = {...binding,version:1,attempt_id:saved?.attempt_id??randomUUID(),run:saved?.run??binding.run};
  }
  get exposed(): boolean {return this.frames.some(frame=>frame.event==='delta');}
  replay(): void {for(const frame of this.frames)this.emit(frame);}
  write(event: DeliveryFrame['event'], fields: Pick<DeliveryFrame,'delta'|'status'|'speakers'|'error'> = {}): DeliveryFrame {
    const frame:DeliveryFrame={...this.binding,event,...fields,sequence:this.frames.length+1,timestamp:Date.now()};
    // Append and flush before exposing bytes to a renderer or a driver observer.
    appendFileSync(this.path,JSON.stringify(frame)+'\n',{flush:true});
    this.frames.push(frame);
    this.emit(frame);
    return frame;
  }
}

/** Decodes only the public text field. The completed artifact is validated separately. */
export class ArtifactTextStream {
  private raw = '';
  private native: boolean | undefined;
  private bytes = 0;
  private prefix = '{"version":1,';
  private at = 0;
  private phase: 'prefix' | 'field' | 'record' | 'separator' | 'text' | 'tail' = 'prefix';
  private field = '';
  private recordText = '';
  private recordBytes = 0;
  private recordDepth = 0;
  private recordQuoted = false;
  private recordEscape = false;
  record: Record<string,unknown> | undefined;
  private escape = false;
  private unicode: string | undefined;
  private pending = '';
  private exposed = '';
  private textBytes = 0;

  private readonly onRecord?: (record:Record<string,unknown>)=>void;
  constructor(onRecord?: (record:Record<string,unknown>)=>void) {this.onRecord=onRecord;}

  push(chunk: string): string {
    this.bytes += Buffer.byteLength(chunk, 'utf8');
    if (this.bytes > 128000) throw new Error('Final artifact exceeds its transport budget');
    this.raw += chunk;
    if(this.native===undefined){
      const head=this.raw.trimStart();
      if(head.length<2)return '';
      if(head.startsWith('{{')){
        const end=head.indexOf('}}');
        if(end<0){if(head.length>32)throw new Error('Invalid public stream marker');return '';}
        const marker=head.slice(0,end+2);
        if(marker!=='{{public}}'&&marker!=='{{reference}}')throw new Error('Invalid public stream marker');
        this.native=true;
        if(marker==='{{reference}}'){this.record={scope:'reference'};this.onRecord?.(this.record);}
        chunk=head.slice(end+2);
      }else{this.native=false;chunk=this.raw;}
    }
    let text = '';
    if(this.native)text=chunk;
    else for (const char of chunk) {
      if (this.phase === 'tail') continue;
      if (this.phase === 'prefix') {
        if (/\s/.test(char)) continue;
        if (char !== this.prefix[this.at++]) throw new Error('Final artifact must begin with version and text');
        if (this.at === this.prefix.length) this.phase = 'field';
      } else if(this.phase==='field') {
        if(/\s/.test(char))continue;
        this.field+=char;
        if(this.field==='"text":"'){this.phase='text';continue;}
        if(this.field==='"record":'){
          if(this.record!==undefined||!this.onRecord)throw new Error('Unexpected private turn record');
          this.phase='record';this.field='';continue;
        }
        if(!'"text":"'.startsWith(this.field)&&!'"record":'.startsWith(this.field))throw new Error('Expected record or public text');
      } else if(this.phase==='record') {
        if(!this.recordText&&/\s/.test(char))continue;
        if(!this.recordText&&char!=='{')throw new Error('Turn record must be an object');
        this.recordText+=char;
        this.recordBytes+=Buffer.byteLength(char,'utf8');
        if(this.recordBytes>32000)throw new Error('Turn record exceeds its budget');
        if(this.recordQuoted){
          if(this.recordEscape)this.recordEscape=false;
          else if(char==='\\')this.recordEscape=true;
          else if(char==='"')this.recordQuoted=false;
        }else if(char==='"')this.recordQuoted=true;
        else if(char==='{'||char==='[')this.recordDepth++;
        else if(char==='}'||char===']')this.recordDepth--;
        if(this.recordDepth===0){
          this.record=JSON.parse(this.recordText);
          if(Object.keys(this.record!).some(key=>!['effects','event','scope','choice'].includes(key)))throw new Error('Invalid turn record fields');
          const record=this.record!;
          const object=(value:unknown)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
          if(record.effects!==undefined&&!Array.isArray(record.effects)
            ||record.event!==undefined&&!object(record.event)
            ||record.scope!==undefined&&record.scope!=='reference'
            ||record.choice!==undefined&&!object(record.choice)
            ||record.scope==='reference'&&(record.event!==undefined||record.effects!==undefined||record.choice!==undefined))
            throw new Error('Invalid private turn record');
          this.onRecord!(this.record!);this.phase='separator';
        }
      } else if(this.phase==='separator') {
        if(/\s/.test(char))continue;
        if(char!==',')throw new Error('Public text must follow the turn record');
        this.phase='field';
      } else if (this.unicode !== undefined) {
        if (!/^[0-9a-f]$/i.test(char)) throw new Error('Invalid artifact Unicode escape');
        this.unicode += char;
        if (this.unicode.length === 4) { text += String.fromCharCode(parseInt(this.unicode, 16)); this.unicode = undefined; }
      } else if (this.escape) {
        this.escape = false;
        if (char === 'u') this.unicode = '';
        else {
          const escapes: Record<string, string> = {'"':'"', '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t'};
          if (!(char in escapes)) throw new Error('Invalid artifact escape');
          text += escapes[char];
        }
      } else if (char === '\\') this.escape = true;
      else if (char === '"') this.phase = 'tail';
      else {
        if (char.charCodeAt(0) < 32) throw new Error('Unescaped artifact control character');
        text += char;
      }
    }
    text = this.pending + text;
    this.pending = '';
    if (text.length && /[\uD800-\uDBFF]/.test(text.at(-1)!)) { this.pending = text.at(-1)!; text = text.slice(0, -1); }
    this.exposed += text;
    this.textBytes += Buffer.byteLength(text,'utf8');
    if (this.textBytes > 64000) throw new Error('Final text exceeds its budget');
    return text;
  }

  finish(): {version: 1; text: string; coverage: unknown[];record?:Record<string,unknown>} {
    if(this.native){
      if(this.pending||!this.exposed.trim())throw new Error('Incomplete public response');
      return {version:1,text:this.exposed,coverage:[],...(this.record?{record:this.record}:{})};
    }
    if (this.phase !== 'tail' || this.pending) throw new Error('Incomplete final artifact text');
    // Inspect root keys before JSON.parse can hide duplicate properties.
    const keys: string[] = [];
    let depth = 0, quoted = false, escaped = false, start = 0, previous = '';
    for (let at = 0; at < this.raw.length; at++) {
      const char = this.raw[at];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') {
          quoted = false;
          if (depth === 1 && (previous === '{' || previous === ',')) keys.push(JSON.parse(this.raw.slice(start, at + 1)));
          previous = '"';
        }
      } else if (char === '"') { quoted = true; start = at; }
      else if (!/\s/.test(char)) {
        if (char === '{' || char === '[') depth++;
        if (char === '}' || char === ']') depth--;
        previous = char;
      }
    }
    const expected=this.record?['version','record','text']:['version','text'];
    if(keys.at(-1)==='coverage')expected.push('coverage');
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('Invalid or duplicate final artifact fields');
    const value = JSON.parse(this.raw);
    if (value.version !== 1 || value.text !== this.exposed || value.coverage!==undefined&&!Array.isArray(value.coverage)) throw new Error('Invalid final artifact');
    return {...value,coverage:value.coverage??[]};
  }
}
