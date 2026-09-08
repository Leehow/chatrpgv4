/** Non-modal preparation view in the host's session-bound overlay slot. */
export function createComponent(React) {
  const h=React.createElement;
  return function Preparation({api,sessionId}) {
    const query=React.useMemo(()=>api.observe?.('onboarding',{action:'current'}),[api]);
    const reply=React.useSyncExternalStore(query?.subscribe||(()=>()=>{}),query?.snapshot||(()=>null),()=>null);
    const job=reply?.ok?reply.data?.current_import:null;
    const [expanded,setExpanded]=React.useState(false),[error,setError]=React.useState('');
    const starting=React.useRef(false);
    React.useEffect(()=>{setExpanded(false);setError('');},[sessionId]);
    React.useEffect(()=>{
      if(!job?.canHandoff)return;
      let active=true,timer;
      const attempt=async()=>{
        if(starting.current)return;
        starting.current=true;
        try{
          const started=await api.invoke('onboarding',{action:'start'});
          if(!active)return;
          if(!started.ok)throw new Error(started.error.message);
          if(started.data?.mode==='play'){active=false;return;}
          const result=await api.invoke('setup-handoff',{});
          if(!result.ok)throw new Error(result.error.message);
          if(result.data?.completed){await api.invoke('onboarding',{action:'start'});active=false;}
        }catch(e){if(active)setError(e.message);}
        finally{starting.current=false;if(active)timer=setTimeout(attempt,1500);}
      };
      void attempt();return()=>{active=false;clearTimeout(timer);};
    },[job?.id,job?.canHandoff,api]);
    if(!sessionId||!job?.campaign||job.playing)return null;
    const phase=job.preparation.opening;
    const ready=phase.state==='ready';
    const stage=phase.stage==='verify'?'Verifying opening sources':'Preparing the opening';
    const title=ready?(job.canHandoff?'Starting game':'Opening ready'):phase.state==='paused'?'Preparation paused':phase.state==='failed'?'Preparation needs attention':stage;
    async function act(action){setError('');try{const result=await api.invoke('onboarding',{action,id:job.id,target:'opening'});if(!result.ok)throw new Error(result.error.message);await query.refresh();}catch(e){setError(e.message);}}
    return h('aside',{className:'coc-preparation-overlay','aria-label':'Scenario preparation'},
      h('style',{},`.workbench-overlays{position:absolute;inset:12px 136px auto auto;z-index:12;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100% - 152px);pointer-events:none}.workbench-overlays>*{pointer-events:auto}.coc-preparation-overlay{width:min(310px,100%);background:var(--surface-raised);border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 24px #0001;color:var(--text);font-size:13px;overflow:hidden}.coc-preparation-overlay button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;padding:12px}.coc-preparation-toggle{display:flex;align-items:center;gap:10px;width:100%;text-align:left}.coc-preparation-toggle span:first-child{color:var(--accent)}.coc-preparation-body{padding:0 14px 14px;line-height:1.5}.coc-preparation-body strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coc-preparation-body progress{width:100%;accent-color:var(--accent)}.coc-preparation-body p{margin:8px 0}.coc-preparation-body button{padding:7px 10px;border:1px solid var(--border);border-radius:8px}@media(max-width:650px){.workbench-overlays{inset:8px 136px auto 12px;max-width:none}.coc-preparation-overlay{width:auto;max-width:100%}.coc-preparation-body{max-width:310px}}`),
      h('button',{className:'coc-preparation-toggle','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},h('span',{},ready?'✓':'◌'),h('span',{},title),h('span',{'aria-hidden':true},expanded?'⌃':'⌄')),
      expanded&&h('div',{className:'coc-preparation-body'},h('strong',{title:job.name},job.name),
        h('p',{},job.canHandoff?'Your investigator and opening are ready. Continuing the meeting…':job.character.state==='confirmed'&&!ready?'Your confirmed investigator is saved. Play will continue when the opening is ready.':ready?'Continue creating your investigator. The opening is ready when you are.':'Create your investigator while the opening is prepared in the background.'),
        !ready&&h('progress',{'aria-label':title,...(phase.progress?.review_total?{max:phase.progress.review_total,value:phase.progress.reviewed||0}:{})}),
        phase.progress?.review_total&&h('p',{},`${phase.progress.reviewed||0} / ${phase.progress.review_total} source groups reviewed`),
        phase.error&&h('details',{},h('summary',{},'Details'),h('p',{},phase.error)),
        !ready&&h('button',{disabled:phase.stopping,onClick:()=>void act(['paused','failed'].includes(phase.state)?'resume':'pause')},phase.stopping?'Pausing…':['paused','failed'].includes(phase.state)?'Resume preparation':'Pause preparation'),
        error&&h('p',{role:'alert'},error)));
  };
}
