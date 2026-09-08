/** Player-facing Mod manager; all state comes from the session-bound host. */
const EMPTY_API = Object.freeze({});
const WORDS = {
  en: {title:"Mods", refresh:"Refresh", install:"Install local Mod", path:"Mod directory or ZIP path", add:"Install",
    campaign:"Enabled in this campaign", defaults:"Enable in new campaigns", unbound:"Select a campaign to change its Mods.",
    update:"Use this version", pending:"Change queued until the table is idle", incompatible:"Incompatible with this game interface",
    loading:"Reading Mods…", empty:"No Mods installed", settings:"Details and changes", version:"Version", failed:"Mod request failed",
    natural:"Natural NPC", naturalDesc:"Appearance or Credit Rating shapes a lasting first impression and the NPC's behavior.",
    items:"Enhanced Items", itemsDesc:"Generate executable item parameters from the story; keep ownership and remaining uses.",
    order:"Load order", orderHint:"Later Mods take precedence for the same feature.", earlier:"Move earlier", later:"Move later",
    overridden:"Overridden by", generator:"Item generator", paper:"Paper editor", check:"Check", audit:"Narrative audit", core:"Core",
    unavailable:"The game runtime is not ready. Open a session, then refresh."},
  "zh-Hans": {title:"Mods", refresh:"刷新", install:"安装本地 Mod", path:"Mod 文件夹或 ZIP 路径", add:"安装",
    campaign:"本局启用", defaults:"新战役默认启用", unbound:"选择一个战役后，可管理本局的 Mods。",
    update:"升级到此版本", pending:"已排队，将在桌面空闲后生效", incompatible:"与当前游戏接口不兼容",
    loading:"正在读取 Mods…", empty:"尚未安装 Mod", settings:"详情与更新记录", version:"版本", failed:"Mod 操作失败",
    natural:"自然 NPC 行为", naturalDesc:"以外貌或信用评级留下初见印象，持续影响 NPC 对待你的方式。",
    items:"物品增强", itemsDesc:"根据剧情生成可执行的物品参数，保留归属、弹药与使用状态。",
    order:"加载顺序", orderHint:"后加载的 Mod 优先接管同名功能。", earlier:"上移", later:"下移",
    overridden:"被覆盖", generator:"物品生成器", paper:"纸面编辑器", check:"检定", audit:"叙事审查", core:"内核",
    unavailable:"游戏运行时尚未就绪。打开会话后刷新。"},
};

export function groupMods(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const group = groups.get(row.id) ?? [];
    group.push(row); groups.set(row.id, group);
  }
  return [...groups.entries()].map(([id, versions]) => ({id, versions}));
}

export function createComponent(React) {
  const h = React.createElement;
  const {useState, useEffect, useRef} = React;
  return function ModsPanel(props) {
    const api = props.api ?? EMPTY_API;
    const [answer, setAnswer] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [path, setPath] = useState("");
    const [importing, setImporting] = useState(false);
    const [selected, setSelected] = useState({});
    const generation = useRef(0);
    const t = WORDS[answer?.play_language ?? "zh-Hans"] ?? WORDS.en;
    async function request(method, params = {}) {
      if (!api.invoke) throw new Error(t.unavailable);
      const result = await api.invoke(method, params);
      if (!result?.ok) throw new Error(result?.error?.message ?? t.failed);
      return result.data;
    }
    async function load() {
      const current = ++generation.current;
      setBusy(true);
      try { const data = await request("mods.list"); if (current === generation.current) {setAnswer(data); setError("");} }
      catch (err) { if (current === generation.current) setError(err.message); }
      finally { if (current === generation.current) setBusy(false); }
    }
    async function mutate(method, params) {
      setBusy(true); setError("");
      try { await request(method, params); await load(); }
      catch (err) { setError(err.message); }
      finally { setBusy(false); }
    }
    useEffect(() => { void load(); return () => { generation.current++; }; }, [api]);
    useEffect(() => api.subscribeExt?.(() => { void load(); }), [api]);
    const unsorted = groupMods(answer?.mods);
    const order = answer?.pending_order || answer?.order || unsorted.map(row=>row.id);
    const groups = unsorted.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    const displayName=id=>id==="natural-npc"?t.natural:id==="enhanced-items"?t.items:id==="core"?t.core:groups.find(row=>row.id===id)?.versions[0]?.name||id;
    const slotName=key=>key==="materializer"?t.generator:key==="document_editor"?t.paper:key.startsWith("audit:")?`${t.audit}: ${key.slice(6)}`:`${t.check}: ${key.replace(/^check:/,"")}`;
    function move(id, delta) {
      const next=[...order],index=next.indexOf(id),other=index+delta;
      if(index<0||other<0||other>=next.length)return;
      [next[index],next[other]]=[next[other],next[index]];
      void mutate("mods.order",{order:next});
    }
    return h("div", {className:"coc-mods", role:"region", "aria-label":"Mods",
      style:{padding:16, overflow:"auto", height:"100%", color:"var(--text)", fontSize:13}},
      h("div", {style:{display:"flex", justifyContent:"space-between", alignItems:"center"}},
        h("strong", {style:{fontSize:18}}, t.title),
        h("button", {type:"button", onClick:()=>void load(), disabled:busy}, t.refresh)),
      !answer?.campaign && h("p", {style:{color:"var(--muted)"}}, t.unbound),
      answer && h("p",{style:{color:"var(--muted)",fontSize:12,lineHeight:1.6}},t.orderHint),
      answer?.pending_order && h("p",{role:"status",style:{color:"var(--accent)"}},t.pending),
      error && h("p", {role:"alert", style:{color:"var(--danger)", overflowWrap:"anywhere"}}, error),
      busy && !answer && h("p", {role:"status"}, t.loading),
      answer && !groups.length && h("p", null, t.empty),
      ...groups.map(({id, versions}) => {
        const active = versions.find(v=>v.active)?.active;
        const row = versions.find(v=>v.version === (selected[id] ?? active?.version)) ?? versions.at(-1);
        const name = id === "natural-npc" ? t.natural : id === "enhanced-items" ? t.items : row.name;
        const description = id === "natural-npc" ? t.naturalDesc : id === "enhanced-items" ? t.itemsDesc : row.description;
        const displaced=Object.entries(answer?.providers||{}).filter(([,providers])=>providers.includes(id)&&providers.at(-1)!==id);
        return h("article", {key:id, style:{border:"1px solid var(--border)", borderRadius:8, padding:14, marginTop:14}},
          h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}},
            h("div",{style:{display:"flex",alignItems:"baseline",gap:8}},
              h("span",{"aria-label":t.order,style:{color:"var(--muted)",fontSize:11}},String(order.indexOf(id)+1).padStart(2,"0")),h("strong",null,name)),
            h("div",{style:{display:"flex",gap:4}},
              h("button",{type:"button","aria-label":`${name} ${t.earlier}`,disabled:busy||order.indexOf(id)<=0,onClick:()=>move(id,-1)},t.earlier),
              h("button",{type:"button","aria-label":`${name} ${t.later}`,disabled:busy||order.indexOf(id)>=order.length-1,onClick:()=>move(id,1)},t.later))),
          ...displaced.map(([key,providers])=>h("p",{key,style:{fontSize:11,color:"var(--accent)",margin:"6px 0"}},`${slotName(key)} · ${t.overridden}: ${displayName(providers.at(-1))}`)),
          h("p", {style:{color:"var(--muted)", lineHeight:1.6}}, description),
          h("div", {style:{display:"flex", gap:8, alignItems:"center", marginBottom:10}},
            h("label", null, t.version, " ", h("select", {"aria-label":`${name} ${t.version}`, disabled:busy,
              value:row.version, onChange:e=>setSelected(s=>({...s,[id]:e.target.value}))},
              ...versions.map(v=>h("option", {key:v.version, value:v.version}, v.version)))),
            h("span", {style:{color:"var(--subtle)"}}, row.author)),
          !row.compatible && h("p", {role:"status"}, t.incompatible),
          h("label", {style:{display:"block", marginBottom:8}},
            h("input", {type:"checkbox", checked:!!active?.enabled, disabled:busy || !answer.campaign || !row.compatible,
              onChange:e=>void mutate("mods.configure", {id, version:row.version, enabled:e.target.checked})}), " ", t.campaign),
          h("label", {style:{display:"block", marginBottom:8}},
            h("input", {type:"checkbox", checked:row.default_enabled, disabled:busy || !row.compatible,
              onChange:e=>void mutate("mods.defaults", {id, enabled:e.target.checked})}), " ", t.defaults),
          active && active.version !== row.version && h("button", {type:"button", disabled:busy || !row.compatible,
            onClick:()=>void mutate("mods.configure", {id, version:row.version})}, t.update),
          row.pending && h("p", {role:"status", style:{color:"var(--accent)"}}, t.pending),
          h("details", null, h("summary", {style:{cursor:"pointer", color:"var(--muted)"}}, t.settings),
            ...Object.entries(row.settings ?? {}).map(([key, fallback]) => {
              const current = active?.version === row.version ? (active.settings?.[key] ?? fallback) : fallback;
              const schema = row.settings_schema?.[key] ?? {};
              const change = value => void mutate("mods.configure", {id, version:row.version,
                settings:{...row.settings, ...(active?.version === row.version ? active.settings : {}), [key]:value}});
              const attributes = {"aria-label":key, disabled:busy || !answer.campaign, style:{maxWidth:"100%"}};
              return h("label", {key, style:{display:"block", marginTop:10}}, key, " ",
                schema.enum ? h("select", {...attributes, value:current, onChange:e=>change(typeof fallback === "number" ? Number(e.target.value) : e.target.value)},
                  ...schema.enum.map(value=>h("option", {key:String(value),value}, String(value))))
                : typeof fallback === "boolean" ? h("input", {...attributes,type:"checkbox",checked:current,onChange:e=>change(e.target.checked)})
                : h("input", {...attributes,type:typeof fallback === "number" ? "number" : "text",defaultValue:current,
                    min:schema.minimum,max:schema.maximum,onBlur:e=>{const value=typeof fallback === "number" ? Number(e.target.value) : e.target.value; if(value!==current)change(value);}}));
            }),
            h("p", {style:{whiteSpace:"pre-wrap"}}, row.changelog || row.description)));
      }),
      h("button", {type:"button", style:{marginTop:16}, onClick:()=>setImporting(v=>!v)}, t.install),
      importing && h("form", {style:{display:"flex", flexDirection:"column", gap:8, marginTop:12},
        onSubmit:e=>{e.preventDefault(); void mutate("mods.install", {path});}},
        h("input", {"aria-label":t.path, placeholder:t.path, value:path, onChange:e=>setPath(e.target.value), disabled:busy}),
        h("button", {type:"submit", disabled:busy || !path.trim()}, t.add)));
  };
}
