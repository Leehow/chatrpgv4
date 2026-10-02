/** Detached, deterministic registration: prose owns delivery; this queue only enriches its cash rows. */
type Row = Record<string, any>;
export function createQuotationQueue(options:{call(method:string,params:Row):Promise<any>; patch(turn:number,quotes:Row):boolean|void; record(row:Row):void; active():boolean}) {
    let stopped=false, tail=Promise.resolve();
    const completed=new Set<string>();
    const timers=new Set<ReturnType<typeof setTimeout>>();
    const alive=()=>!stopped&&options.active();
    const enqueue=(turn?:number):Promise<void>=>{
        const task=async()=>{
            if(!alive())return;
            const started=Date.now();
            try {
                const listing=turn===undefined?await options.call('table.quotes.flush',{}):undefined;
                const turns=listing?.turns??(turn===undefined?[]:[turn]);
                for(const current of turns){
                    if(!alive())return;
                    if(listing?.keys?.[current] && completed.has(listing.keys[current]))continue;
                    const result=await options.call('table.quotes.flush',{turn:current});
                    if(!alive())return;
                    if(result.stale || !Object.keys(result.quotes??{}).length)continue;
                    const key=Object.keys(result.quotes)[0]!;
                    if(completed.has(key))continue;
                    if(options.patch(current,result.quotes)!==false)completed.add(key);
                    options.record({lane:'quote-registration',turn:current,ok:Object.values(result.quotes).every((quote:any)=>quote.quote_status!=='failed'),
                        wall_ms:Date.now()-started,statuses:Object.values(result.quotes).map((quote:any)=>({quote:quote.quote,status:quote.quote_status}))});
                }
            }catch(error){if(alive())options.record({lane:'quote-registration',turn,ok:false,reason:error instanceof Error?error.message:String(error)});}
        };
        return tail=tail.then(task,task);
    };
    return {
        schedule(turn?:number):void {
            // A macrotask lets the completed delivery/tool response reach its reader first.
            const timer=setTimeout(()=>{timers.delete(timer);void enqueue(turn);},0);timers.add(timer);
        },
        finish:()=>enqueue(),
        close():void {stopped=true;for(const timer of timers)clearTimeout(timer);timers.clear();},
    };
}
