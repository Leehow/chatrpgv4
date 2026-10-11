/** Per-turn evidence coverage; no semantic conclusion or future obligation is inferred. */
export class DocumentReadCoverage{
    private readonly documents=new Map<string,{revision:number;total:number;pages:Set<number>}>();
    private readonly continuations=new Set<string>();
    private key(input:Record<string,any>):string|undefined{
        if(input.focus==='knowledge'){
            const page=input.knowledge_page,scope=page?.context;
            if(!scope||!Number.isSafeInteger(page.offset)||page.offset<0||!Number.isSafeInteger(page.limit)||page.limit<1
                ||!Number.isSafeInteger(scope.turn)||!Number.isSafeInteger(scope.view)||!Number.isSafeInteger(scope.loop)||typeof scope.line!=='string'
                ||input.name!==undefined&&typeof input.name!=='string')return;
            return JSON.stringify(['knowledge',input.name??null,page.offset,page.limit,scope.turn,scope.view,scope.line,scope.loop]);
        }
        if(input.focus!=='object'||typeof input.name!=='string'||!Number.isSafeInteger(input.document_page)
            ||input.document_page<1||!Number.isSafeInteger(input.document_revision)||input.document_revision<1
            ||input.document_query!==undefined&&typeof input.document_query!=='string')return;
        return JSON.stringify([input.name,input.document_revision,input.document_page,input.document_query??null]);
    }
    permits(input:Record<string,any>):boolean{const key=this.key(input);return key!==undefined&&this.continuations.has(key);}
    consume(input:Record<string,any>):boolean{const key=this.key(input);return key!==undefined&&this.continuations.delete(key);}
    /** Only host-issued public reads bypass the ordinary look count, once each. They grant no world authority. */
    addKnowledge(result:Record<string,any>):void{
        if(!result||!['catalogue','original'].includes(result.status))return;
        const references=[result.next,...(Array.isArray(result.entries)?result.entries.map(entry=>entry.read):[]),
            ...(Array.isArray(result.originals)?result.originals.map(original=>original.next):[])];
        for(const reference of references){if(!reference)continue;const key=this.key(reference);if(key)this.continuations.add(key);}
    }
    add(result:Record<string,any>):void{
        const read=result.document_read;
        if(!read||!['page','literal'].includes(read.mode)||typeof read.name!=='string'||!Number.isSafeInteger(read.revision)
            ||!Number.isSafeInteger(read.page)||!Number.isSafeInteger(read.page_count)||read.page<1||read.page>read.page_count)return;
        for(const next of [read.next,read.read_pages])if(next&&next.name===read.name&&next.document_revision===read.revision){
            const key=this.key(next);if(key)this.continuations.add(key);
        }
        if(read.mode!=='page')return;
        let entry=this.documents.get(read.name);
        if(!entry||entry.revision!==read.revision||entry.total!==read.page_count){
            entry={revision:read.revision,total:read.page_count,pages:new Set()};this.documents.set(read.name,entry);
        }
        entry.pages.add(read.page);
        read.coverage={...read.coverage,pages_supplied:[...entry.pages].sort((a,b)=>a-b),
            all_pages_supplied:entry.pages.size===entry.total,
            instruction:'Pages supplied in this player turn at this revision. Judge relevance from the words; missing pages cannot support semantic absence.'};
    }
}
