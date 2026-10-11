/**
 * Contract §227.2: what an input discloses to the Keeper (apply capability detail, package sections) is sent once and
 * stays where it was first placed. Every later request of the input re-inserts the same message at the same place in
 * the turn, so the request prefix the provider cached is never edited, reordered or re-sent at the end.
 */
type Row=Record<string,any>;
type Delivery={anchor:number;message:Row;keys:string[]};

/** A turn's own traffic: the Keeper's calls and their results, in the order the transcript holds them. */
const traffic=(message:Row)=>message.role==='assistant'||message.role==='toolResult';

export function createTurnDisclosure(){
    let input='';
    const deliveries:Delivery[]=[];
    /** Keys whose content reached a request or a result of this input. */
    const delivered=new Set<string>();
    /** Keys a call used before they were delivered; the call's result or the next request carries them. */
    const owed=new Set<string>();
    /**
     * Name the input; the same input keeps its deliveries and their places. What was attached or owed after `clear()`
     * and before the input's first prepared request belongs to that input and is kept.
     */
    function begin(key:string){
        if(key===input)return;
        if(input){deliveries.length=0;delivered.clear();owed.clear();}
        input=key;
    }
    /** The current input's own turn traffic, counted after its player message. */
    function count(messages:readonly Row[]):number{
        const start=lastUser(messages);
        return messages.slice(start+1).filter(traffic).length;
    }
    /**
     * Add one message for keys not yet delivered. Its anchor is the turn traffic already sent, so it lands after
     * everything an earlier request carried and keeps that place afterwards.
     */
    function offer(keys:readonly string[],anchor:number,build:(fresh:string[])=>Row|undefined):Row|undefined{
        const fresh=[...new Set(keys)].filter(key=>!delivered.has(key));
        if(!fresh.length)return;
        const message=build(fresh);
        if(!message)return;
        deliveries.push({anchor,message,keys:fresh});
        for(const key of fresh){delivered.add(key);owed.delete(key);}
        return message;
    }
    /** Withdraw a delivery that could not be sent; its keys count as undelivered again. */
    function withdraw(message:Row){
        const at=deliveries.findIndex(d=>d.message===message);
        if(at<0)return;
        for(const key of deliveries[at].keys)delivered.delete(key);
        deliveries.splice(at,1);
    }
    /**
     * Insert every delivery of the input at its place: before the turn's traffic message it preceded, or before the
     * host's end-of-request material (`tailStart`) when no traffic has followed it yet.
     */
    function place(messages:Row[],tailStart:number):Row[]{
        if(!deliveries.length)return messages;
        const start=lastUser(messages);
        const head=messages.slice(0,tailStart),tail=messages.slice(tailStart);
        const positions:number[]=[];
        head.forEach((message,index)=>{if(index>start&&traffic(message))positions.push(index);});
        const out:Row[]=[],at=(d:Delivery)=>positions[d.anchor]??head.length;
        let next=0;
        for(let index=0;index<=head.length;index++){
            while(next<deliveries.length&&at(deliveries[next])<=index)out.push(deliveries[next++].message);
            if(index<head.length)out.push(head[index]);
        }
        return[...out,...tail];
    }
    function messages(){return deliveries.map(d=>d.message);}
    return{begin,count,offer,withdraw,place,messages,
        has:(key:string)=>delivered.has(key),
        /** A call used these keys undelivered; they are owed until a result or a request carries them. */
        owe:(keys:Iterable<string>)=>{for(const key of keys)if(!delivered.has(key))owed.add(key);},
        owed:()=>[...owed],
        /** A result carried these keys. */
        attached:(keys:Iterable<string>)=>{for(const key of keys){delivered.add(key);owed.delete(key);}},
        clear:()=>{input='';deliveries.length=0;delivered.clear();owed.clear();}};
}

function lastUser(messages:readonly Row[]):number{
    for(let index=messages.length-1;index>=0;index--)if(messages[index].role==='user')return index;
    return-1;
}
