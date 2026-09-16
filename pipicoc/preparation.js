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
    // A preparation that stopped is the one state the player has to act on, and the fold used to be
    // the only place saying so. Opening it once on the transition is the signal; it is not re-opened
    // afterwards, so closing it again stays closed.
    const stalled=job?.campaign&&!job.playing&&!job.hidden&&['paused','failed'].includes(job.preparation?.opening?.state);
    const wasStalled=React.useRef(false);
    React.useEffect(()=>{if(stalled&&!wasStalled.current)setExpanded(true);wasStalled.current=!!stalled;},[stalled]);
    if(!sessionId||!job?.campaign||job.playing||job.hidden)return null;
    const phase=job.preparation.opening;
    const ready=phase.state==='ready';
    const stage=phase.stage==='verify'?t('stage.verify'):t('stage.opening');
    const title=ready?(job.canHandoff?t('starting'):t('ready')):phase.state==='paused'?t('paused'):phase.state==='failed'?t('failed'):stage;
    const phaseError=phase.error?failure(phase.error):null;
    // Everything below travels the *collapsed* head, because that is the whole of BUG-005: a 669-page
    // module spent seventeen minutes behind one folded line reading "preparing the opening" while the
    // panel already held a real 12/13 count, a pause control, and a stopped phase waiting to be
    // resumed by hand. `attention` is the stopped phase; `counted` is the count as digits, so the
    // progress reaches every play language without a caption of its own (`reviewed` names it for a
    // screen reader and on hover); `total` drives a determinate bar the fold no longer hides.
    const attention=!ready&&['paused','failed'].includes(phase.state);
    const total=phase.progress?.review_total||0;
    const done=phase.progress?.reviewed||0;
    const counted=total?`${done}/${total}`:null;
    async function hide(){setError(null);try{const result=await api.invoke('onboarding',{action:'hide',id:job.id});if(!result.ok)throw result.error;await query.refresh();}catch(e){setExpanded(true);setError(failure(e));}}
    async function act(action){setError(null);try{const result=await api.invoke('onboarding',{action,id:job.id,target:'opening'});if(!result.ok)throw result.error;await query.refresh();}catch(e){setError(failure(e));}}
    return h('aside',{className:'coc-preparation-overlay','aria-label':t('label')},
      h('style',{},`.workbench-overlays{position:absolute;inset:12px 136px auto auto;z-index:12;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100% - 152px);pointer-events:none}.workbench-overlays>*{pointer-events:auto}.coc-preparation-overlay{width:min(310px,100%);background:var(--surface-raised);border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 24px #0001;color:var(--text);font-size:13px;overflow:hidden}.coc-preparation-overlay button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;padding:12px}.coc-preparation-head{display:flex;align-items:center}.coc-preparation-toggle{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left}.coc-preparation-toggle span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coc-preparation-close{padding:12px 12px 12px 2px;opacity:.55}.coc-preparation-close:hover{opacity:1}.coc-preparation-count{flex:none;font-variant-numeric:tabular-nums;opacity:.7}.coc-preparation-head .coc-preparation-act{flex:none;margin:0 10px 0 2px;padding:5px 9px;border:1px solid var(--border);border-radius:8px;white-space:nowrap}.coc-preparation-head .coc-preparation-act[disabled]{opacity:.55;cursor:default}.coc-preparation-track{display:block;width:100%;height:3px;border:0;background:transparent;accent-color:var(--accent)}.coc-preparation-toggle span:first-child{color:var(--accent)}.coc-preparation-body{padding:0 14px 14px;line-height:1.5}.coc-preparation-body strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coc-preparation-body progress{width:100%;accent-color:var(--accent)}.coc-preparation-body p{margin:8px 0}.coc-preparation-body button{padding:7px 10px;border:1px solid var(--border);border-radius:8px}@media(max-width:650px){.workbench-overlays{inset:8px 136px auto 12px;max-width:none}.coc-preparation-overlay{width:auto;max-width:100%}.coc-preparation-body{max-width:310px}}`),
      h('div',{className:'coc-preparation-head'},
        h('button',{className:'coc-preparation-toggle','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},
          h('span',{},ready?'✓':attention?'!':'◌'),h('span',{},title),
          counted?h('span',{className:'coc-preparation-count',title:t('reviewed',{done,total})},counted):null,
          h('span',{'aria-hidden':true},expanded?'⌃':'⌄')),
        // A stopped preparation offers its one action in the head, so the player never has to open a
        // fold to learn that anything is theirs to do.
        attention&&h('button',{className:'coc-preparation-act',disabled:phase.stopping,onClick:()=>void act('resume')},
          phase.stopping?t('pausing'):t('resume')),
        // Only a finished preparation may be hidden: while it can still be paused, resumed or
        // retried, this overlay is the only place holding those controls.
        ready&&h('button',{className:'coc-preparation-close','aria-label':t('hide'),onClick:()=>void hide()},'✕')),
      // The collapsed bar: a run that is moving says so without being opened, and a determinate one
      // says how far. `title` is the same line the body prints, for a pointer and a screen reader.
      !ready&&h('progress',{className:'coc-preparation-track','aria-label':counted?t('reviewed',{done,total}):title,
        ...(total?{max:total,value:done}:{})}),
      expanded&&h('div',{className:'coc-preparation-body'},h('strong',{title:job.name},job.name),
        // Every standing line here says the opening arrives on its own -- "play will continue when
        // the opening is ready", "create your investigator while it prepares in the background". A
        // stopped phase is the one state where that is false, and saying it there is what kept a
        // real table waiting forever beside a Resume control it had no reason to touch (BUG-039).
        // A stopped phase says its own reason instead: the failure's caption is already on the fold
        // below, and `attention` puts the control that finishes it in the head.
        attention?null:h('p',{},job.canHandoff?t('body.handoff'):job.character.state==='confirmed'&&!ready?t('body.confirmed'):ready?t('body.ready'):t('body.preparing')),
        // The bar moved into the head, where it is visible folded; drawing it twice when the fold is
        // open says nothing the head has not already said.
        total?h('p',{},t('reviewed',{done,total})):null,
        // The same shape as the host error below and as the wizard's: the caption is the player's
        // explanation and is read without opening anything; the message is the diagnostic, in the
        // system language, behind `details` where a log line belongs.
        phaseError&&h('p',{},said(phaseError)),
        phaseError&&phaseError.message?h('details',{},h('summary',{},word(ui,'errors','details')),h('p',{},phaseError.message)):null,
        !ready&&h('button',{disabled:phase.stopping,onClick:()=>void act(['paused','failed'].includes(phase.state)?'resume':'pause')},phase.stopping?t('pausing'):['paused','failed'].includes(phase.state)?t('resume'):t('pause')),
        error&&h('p',{role:'alert'},said(error),
          error.message?h('details',{},h('summary',{},word(ui,'errors','details')),h('p',{},error.message)):null)));
  };
}
