/** The host supplies React and the existing capability-restricted invoke port. */
export function createComponent(React) {
  const {createElement:h,useState,useEffect}=React;
  return function MiniMaxPanel({api}) {
    const [status,setStatus]=useState(),[provider,setProvider]=useState('minimax-cn'),[prompt,setPrompt]=useState(''),
      [task,setTask]=useState(''),[result,setResult]=useState(),[busy,setBusy]=useState(false),[error,setError]=useState('');
    async function invoke(method,args={}) {
      if (!api.invoke) {setError('Open a chat to use MiniMax operations.');return;}
      setBusy(true);setError('');
      try {
        const reply=await api.invoke(method,args);
        if (!reply?.ok) throw Error(typeof reply?.error==='string' ? reply.error : reply?.error?.message ?? 'MiniMax operation unavailable');
        if (method==='status') setStatus(reply.data);
        else if(method==='video-create') {setTask(reply.data.task_id);setResult(reply.data);}
        else if(method==='video-status') setResult(reply.data);
        else setResult(reply.data);
      } catch(e) {setError(e.message);} finally {setBusy(false);}
    }
    useEffect(()=>{void invoke('status');},[]);
    const button=(label,method,args,disabled=false)=>h('button',{type:'button',disabled:busy||disabled,onClick:()=>void invoke(method,args)},label);
    return h('section',null,
      h('p',null,'MiniMax accounts are shared with Model Management. Image generation follows your explicit image-model choice.'),
      h('label',null,'Account ',h('select',{value:provider,disabled:busy,onChange:e=>setProvider(e.target.value)},
        ...['minimax-cn','minimax'].map(id=>h('option',{key:id,value:id},id)))),
      status ? h('p',null,status.accounts.map(row=>`${row.provider}: ${row.configured?'configured':'not configured'}`).join(' · ')) : null,
      button('Use image-01','image-model',{model:`${provider}/image-01`}),
      button('Use image-01-live','image-model',{model:`${provider}/image-01-live`}),
      h('p',null,'Use the character-sheet photo control for portraits and Generate illustration beside a narration for scene images. Scene images reuse the character portrait when eligible.'),
      status ? h('p',null,`Image model: ${status.imageModel ?? 'automatic'}`) : null,
      status?.cache ? h('section',null,
        h('h3',null,'Cache usage'),
        h('p',null,'Only provider-reported tokens are counted. Unreported writes are unknown; a reported zero does not prove no server write occurred.'),
        ...['read','write'].map(field=>h('p',{key:field},`Cache ${field}: ${status.cache[field].tokens ?? 'unreported'} tokens · ${status.cache[field].reported_requests}/${status.cache.requests} requests reported`)),
        h('p',null,`Complete cache read ratio: ${status.cache.cache_read_ratio === null ? 'unavailable' : (status.cache.cache_read_ratio*100).toFixed(1)+'%'}`),
        h('p',null,`Reported input read share (writes excluded): ${status.cache.reported_read_share == null ? 'unavailable' : (status.cache.reported_read_share*100).toFixed(1)+'%'}`),
        h('ul',null,...status.cache.recent.map((row,i)=>h('li',{key:i},`${row.model} #${row.request}: read ${row.read ?? 'unreported'}, write ${row.write ?? 'unreported'}, input ${row.input ?? 'unreported'}`))),
        button('Refresh cache statistics','status')) : null,
      h('p',null,'Create a five-second H3 video. Submission returns a task ID; check it later for the result link.'),
      h('textarea',{value:prompt,disabled:busy,maxLength:7000,placeholder:'Describe the video',onChange:e=>setPrompt(e.target.value)}),
      button('Create video','video-create',{provider,prompt},!prompt.trim()),
      h('input',{value:task,disabled:busy,placeholder:'Video task ID',onChange:e=>setTask(e.target.value)}),
      button('Check video','video-status',{provider,task_id:task},!task.trim()),
      status?.tasks?.length ? h('div',null,...status.tasks.map(row=>h('button',{key:row.task_id,type:'button',disabled:busy,onClick:()=>{setTask(row.task_id);setProvider(row.provider);}},row.task_id))) : null,
      result ? h('p',null, result.status ?? result.model, result.url ? h('a',{href:result.url,target:'_blank',rel:'noreferrer'},' Open video') : null) : null,
      error ? h('p',{role:'alert'},error) : null);
  };
}
