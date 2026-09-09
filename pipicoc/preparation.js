/**
 * Non-modal preparation view in the host's session-bound overlay slot.
 *
 * Every word comes from the snapshot's own `ui = {tag, words}` (§23, 2026-09-09): this file shipped
 * English-only, which read as a language rule nobody had chosen. A host failure shows its code's
 * caption from the `errors` surface and keeps the English message behind a fold, because that
 * message is written for the log.
 */

/** A caption from the snapshot's `ui` block, or `fallback` -- the key by default. */
function word(ui, surface, key, fallback) {
  const words = ui && typeof ui === 'object' && ui.words && typeof ui.words === 'object' ? ui.words : {};
  const table = words[surface] && typeof words[surface] === 'object' ? words[surface] : {};
  return typeof table[key] === 'string' ? table[key] : fallback === undefined ? key : fallback;
}

/** A parameterised caption: `{name}` placeholders filled from `values`. */
function fill(template, values) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
}

/** A `{code, message}` pair from anything a host refused with. */
function failure(reason) {
  if (reason && typeof reason === 'object')
    return {code: typeof reason.code === 'string' ? reason.code : '', message: typeof reason.message === 'string' ? reason.message : ''};
  return {code: '', message: reason === undefined || reason === null ? '' : String(reason)};
}

export function createComponent(React) {
  const h=React.createElement;
  return function Preparation({api,sessionId}) {
    const query=React.useMemo(()=>api.observe?.('onboarding',{action:'current'}),[api]);
    const reply=React.useSyncExternalStore(query?.subscribe||(()=>()=>{}),query?.snapshot||(()=>null),()=>null);
    const job=reply?.ok?reply.data?.current_import:null;
    const ui=reply?.ok?reply.data?.ui:null;
    const [expanded,setExpanded]=React.useState(false),[error,setError]=React.useState(null);
    const starting=React.useRef(false);
    const t=(key,values)=>values?fill(word(ui,'preparation',key),values):word(ui,'preparation',key);
    const said=reason=>word(ui,'errors',reason.code,word(ui,'errors','unknown'));
    React.useEffect(()=>{setExpanded(false);setError(null);},[sessionId]);
    React.useEffect(()=>{
      if(!job?.canHandoff)return;
      let active=true,timer;
      const attempt=async()=>{
        if(starting.current)return;
        starting.current=true;
        try{
          const started=await api.invoke('onboarding',{action:'start'});
          if(!active)return;
          if(!started.ok)throw started.error;
          if(started.data?.mode==='play'){active=false;return;}
          const result=await api.invoke('setup-handoff',{});
          if(!result.ok)throw result.error;
          if(result.data?.completed){await api.invoke('onboarding',{action:'start'});active=false;}
        }catch(e){if(active)setError(failure(e));}
        finally{starting.current=false;if(active)timer=setTimeout(attempt,1500);}
      };
      void attempt();return()=>{active=false;clearTimeout(timer);};
    },[job?.id,job?.canHandoff,api]);
    if(!sessionId||!job?.campaign||job.playing||job.hidden)return null;
    const phase=job.preparation.opening;
    const ready=phase.state==='ready';
    const stage=phase.stage==='verify'?t('stage.verify'):t('stage.opening');
    const title=ready?(job.canHandoff?t('starting'):t('ready')):phase.state==='paused'?t('paused'):phase.state==='failed'?t('failed'):stage;
    const phaseError=phase.error?failure(phase.error):null;
    async function hide(){setError(null);try{const result=await api.invoke('onboarding',{action:'hide',id:job.id});if(!result.ok)throw result.error;await query.refresh();}catch(e){setExpanded(true);setError(failure(e));}}
    async function act(action){setError(null);try{const result=await api.invoke('onboarding',{action,id:job.id,target:'opening'});if(!result.ok)throw result.error;await query.refresh();}catch(e){setError(failure(e));}}
    return h('aside',{className:'coc-preparation-overlay','aria-label':t('label')},
      h('style',{},`.workbench-overlays{position:absolute;inset:12px 136px auto auto;z-index:12;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100% - 152px);pointer-events:none}.workbench-overlays>*{pointer-events:auto}.coc-preparation-overlay{width:min(310px,100%);background:var(--surface-raised);border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 24px #0001;color:var(--text);font-size:13px;overflow:hidden}.coc-preparation-overlay button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;padding:12px}.coc-preparation-head{display:flex;align-items:center}.coc-preparation-toggle{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left}.coc-preparation-toggle span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coc-preparation-close{padding:12px 12px 12px 2px;opacity:.55}.coc-preparation-close:hover{opacity:1}.coc-preparation-toggle span:first-child{color:var(--accent)}.coc-preparation-body{padding:0 14px 14px;line-height:1.5}.coc-preparation-body strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coc-preparation-body progress{width:100%;accent-color:var(--accent)}.coc-preparation-body p{margin:8px 0}.coc-preparation-body button{padding:7px 10px;border:1px solid var(--border);border-radius:8px}@media(max-width:650px){.workbench-overlays{inset:8px 136px auto 12px;max-width:none}.coc-preparation-overlay{width:auto;max-width:100%}.coc-preparation-body{max-width:310px}}`),
      h('div',{className:'coc-preparation-head'},
        h('button',{className:'coc-preparation-toggle','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},h('span',{},ready?'✓':'◌'),h('span',{},title),h('span',{'aria-hidden':true},expanded?'⌃':'⌄')),
        // Only a finished preparation may be hidden: while it can still be paused, resumed or
        // retried, this overlay is the only place holding those controls.
        ready&&h('button',{className:'coc-preparation-close','aria-label':t('hide'),onClick:()=>void hide()},'✕')),
      expanded&&h('div',{className:'coc-preparation-body'},h('strong',{title:job.name},job.name),
        h('p',{},job.canHandoff?t('body.handoff'):job.character.state==='confirmed'&&!ready?t('body.confirmed'):ready?t('body.ready'):t('body.preparing')),
        !ready&&h('progress',{'aria-label':title,...(phase.progress?.review_total?{max:phase.progress.review_total,value:phase.progress.reviewed||0}:{})}),
        phase.progress?.review_total&&h('p',{},t('reviewed',{done:phase.progress.reviewed||0,total:phase.progress.review_total})),
        phaseError&&h('details',{},h('summary',{},said(phaseError)),h('p',{},phaseError.message||word(ui,'errors','details'))),
        !ready&&h('button',{disabled:phase.stopping,onClick:()=>void act(['paused','failed'].includes(phase.state)?'resume':'pause')},phase.stopping?t('pausing'):['paused','failed'].includes(phase.state)?t('resume'):t('pause')),
        error&&h('p',{role:'alert'},said(error),
          error.message?h('details',{},h('summary',{},word(ui,'errors','details')),h('p',{},error.message)):null)));
  };
}
