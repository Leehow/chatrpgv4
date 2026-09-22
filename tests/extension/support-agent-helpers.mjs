/** Controlled typed decisions for request/owner tests. Never a Keeper or gameplay driver. */
export function supportChoices(batch,select=()=> 'necessary',{discover=false,qualify=false,check='no_roll',difficulty='regular',bonus='none',skill}={}) {
    const state=batch.state??{},operations=state.operations??[],describe=operation=>({kind:operation.basis?.kind,
        label:operation.label,summary:operation.description,body:operation.basis?.preview,authority:operation.basis?.authority});
    const eligible=operations.filter(operation=>operation.tool==='read'&&operation.basis?.kind&&select(describe(operation))!=='skip');
    const priority=operation=>({necessary:0,helpful:1,uncertain:2}[select(describe(operation))]??3);
    eligible.sort((left,right)=>priority(left)-priority(right));
    const qualification=qualify?operations.find(operation=>operation.label==='Validate original source support'):undefined;
    const indexes=operations.filter(operation=>operation.tool==='discover'&&operation.basis?.candidates?.some(candidate=>select(candidate)!=='skip'));
    const groupPriority=operation=>Math.min(...operation.basis.candidates.map(candidate=>({necessary:0,helpful:1,uncertain:2}[select(candidate)]??3)));
    const index=indexes.sort((left,right)=>groupPriority(left)-groupPriority(right))[0];
    const next=eligible[0]??qualification??index??(discover?operations.find(operation=>operation.tool==='discover'):undefined);
    const result={};
    for(const question of batch.questions){const key=question.key,criteria=Object.keys(question.criteria??{});let value;
        if(key==='operation')value=next?.alias??'finish';
        else if(key==='coverage')value=next?'missing':'sufficient';
        else if(key==='consistency')value='clear';
        else if(key.startsWith('include_')){
            const operation=operations.find(operation=>`include_${operation.alias}`===key);
            value=operation&&eligible.includes(operation)?'include':'skip';
        }else if(key==='route')value=criteria.includes('plaintext')?'plaintext':check;
        else if(key==='consent')value='authorized';
        else if(key==='actor')value=criteria.find(value=>value.startsWith('actor_'))??'unknown';
        else if(key==='intent')value='investigate';
        else if(key==='difficulty')value=difficulty;
        else if(key==='bonus')value=bonus;
        else if(key==='penalty')value='none';
        else if(key==='profile')value=(skill?criteria.find(value=>question.criteria[value]?.skill===skill):criteria.find(value=>value.startsWith('profile_')))??'unknown';
        else if(criteria.includes('plaintext'))value='plaintext';
        else if(criteria.includes('evidence'))value='evidence';
        else value=criteria.includes('unknown')?'unknown':criteria[0];
        result[key]=value;
    }
    return result;
}
export function supportDecision(select,options){return{async decide(batch){return{batchId:batch.id,status:'complete',attempts:1,
    usage:{inputTokens:10,outputTokens:2},coverage:{required:[],answered:[],unknown:[]},issues:[],
    answers:Object.fromEntries(Object.entries(supportChoices(batch,select,options)).map(([key,choice])=>[key,{status:'answered',type:'choice',choice}]))};}};}
export function supportWire(sent,select,options){
    const batch={state:sent.state,questions:Object.entries(sent.questions).map(([key,question])=>({key,...question}))};
    const choices=supportChoices(batch,select,options);
    return {model:sent.model,usage:{input_tokens:10,output_tokens:2},answers:Object.fromEntries(batch.questions.map(question=>[question.key,
        {type:'choice',choice:choices[question.key],confidence:1,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key===choices[question.key]?1:0]))}]))};
}
