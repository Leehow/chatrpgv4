/** Incremental transport projection of native write.parts text, never argument repair. */
type Frame={kind:'object'|'array';path:(string|number)[];phase:'key'|'colon'|'value'|'comma';key?:string;index:number};
export class AuthorPartsStream {
 private frames:Frame[]=[];
 private quoted=false;private key=false;private field='';private publicString=false;
 private escape=false;private unicode:string|undefined;private pending='';private primitive=false;
 private bytes=0;private textBytes=0;private value='';
 get text(){return this.value;}
 private path():(string|number)[]{
  const frame=this.frames.at(-1);if(!frame)return [];
  if(frame.phase!=='value')throw Error('Invalid author argument stream');
  const path=[...frame.path,frame.kind==='array'?frame.index++:frame.key!];frame.phase='comma';return path;
 }
 private isText(path:(string|number)[]):boolean {
  const names=path.filter(part=>typeof part==='string'&&part!=='item');
  return names.length===2&&names[0]==='parts'&&names[1]==='text'&&path.filter(part=>part==='item').length<=4;
 }
 push(chunk:string):string {
  this.bytes+=Buffer.byteLength(chunk);if(this.bytes>128000)throw Error('Final artifact exceeds its transport budget');
  let text='';
  const append=(value:string)=>{
   if(!this.publicString)return;
   text+=this.pending+value;this.pending='';
   if(text.length&&/[\uD800-\uDBFF]/.test(text.at(-1)!)){this.pending=text.at(-1)!;text=text.slice(0,-1);}
  };
  for(const char of chunk){
   if(this.quoted){
    if(this.unicode!==undefined){
     if(!/^[0-9a-f]$/i.test(char))throw Error('Invalid author argument escape');
     this.unicode+=char;if(this.unicode.length===4){const decoded=String.fromCharCode(parseInt(this.unicode,16));this.field+=decoded;append(decoded);this.unicode=undefined;}continue;
    }
    if(this.escape){
     this.escape=false;if(char==='u'){this.unicode='';continue;}
     const escaped:Record<string,string>={'"':'"','\\':'\\','/':'/',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'};
     if(!Object.hasOwn(escaped,char))throw Error('Invalid author argument escape');this.field+=escaped[char];append(escaped[char]);continue;
    }
    if(char==='\\'){this.escape=true;continue;}
    if(char==='"'){
     if(this.pending)throw Error('Incomplete author Unicode text');
     this.quoted=false;if(this.key){const frame=this.frames.at(-1)!;frame.key=this.field;frame.phase='colon';}this.publicString=false;continue;
    }
    if(char.charCodeAt(0)<32)throw Error('Invalid author argument control character');
    this.field+=char;append(char);continue;
   }
   if(this.primitive){if(!/[\s,}\]]/.test(char))continue;this.primitive=false;}
   if(/\s/.test(char))continue;
   const frame=this.frames.at(-1);
   if(char==='"'){
    this.key=frame?.kind==='object'&&frame.phase==='key';
    this.publicString=!this.key&&this.isText(this.path());this.field='';this.quoted=true;continue;
   }
   if(char==='{'||char==='['){
    const path=this.path();if(this.frames.length>=32)throw Error('Author argument nesting exceeds its transport budget');
    this.frames.push({kind:char==='{'?'object':'array',path,phase:char==='{'?'key':'value',index:0});continue;
   }
   if(char==='}'||char===']'){
    if(!frame||frame.kind!==(char==='}'?'object':'array'))throw Error('Invalid author argument boundary');this.frames.pop();continue;
   }
   if(char===':'){if(frame?.kind!=='object'||frame.phase!=='colon')throw Error('Invalid author argument separator');frame.phase='value';continue;}
   if(char===','){if(frame?.phase!=='comma')throw Error('Invalid author argument separator');frame.phase=frame.kind==='object'?'key':'value';continue;}
   this.path();this.primitive=true;
  }
  this.textBytes+=Buffer.byteLength(text);if(this.textBytes>64000)throw Error('Final text exceeds its budget');this.value+=text;return text;
 }
}
