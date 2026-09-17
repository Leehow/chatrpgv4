/**
 * Player-facing Mod manager; all state comes from the session-bound host.
 *
 * No word table and no Mod named in code (§23, 2026-09-09). The `mods.*` answer carries
 * `ui = {tag, words}` for the session's play language, and a Mod's own `name` / `description`
 * come from its manifest -- a string, or an object keyed by language tag, which is how a Mod ships
 * more than one language. Hand-translating two Mods here meant every third Mod stayed English.
 */
const EMPTY_API = Object.freeze({});

/** A caption from the answer's `ui` block, or `fallback` -- the key by default. */
function word(ui, surface, key, fallback) {
  const words = ui && typeof ui === "object" && ui.words && typeof ui.words === "object" ? ui.words : {};
  const table = words[surface] && typeof words[surface] === "object" ? words[surface] : {};
  return typeof table[key] === "string" ? table[key] : fallback === undefined ? key : fallback;
}

/**
 * A manifest field the Mod author may have written once or per language.
 *
 * A plain string is the Mod's only wording and is shown as it stands. An object keyed by tag is
 * read at the session's tag first, and otherwise at whatever wording it does carry: a Mod that
 * speaks one language the player does not is still better named than by its id.
 */
export function authored(value, tag) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (typeof value[tag] === "string" && value[tag]) return value[tag];
  for (const word of Object.values(value)) if (typeof word === "string" && word) return word;
  return "";
}
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
    // A refusal is kept whole -- {code, message} -- because the caption is the code's and the
    // English message only ever travels behind a fold.
    const [error, setError] = useState(null);
    const [path, setPath] = useState("");
    const [importing, setImporting] = useState(false);
    const [selected, setSelected] = useState({});
    const generation = useRef(0);
    const ui = answer?.ui;
    const t = (key, fallback) => word(ui, "mods", key, fallback);
    const said = (failure) => word(ui, "errors", failure.code, word(ui, "errors", "unknown"));
    async function request(method, params = {}) {
      if (!api.invoke) throw {code:"runtime_unavailable", message:"this host cannot reach the game runtime"};
      const result = await api.invoke(method, params);
      if (!result?.ok) throw {code:result?.error?.code ?? "", message:result?.error?.message ?? ""};
      return result.data;
    }
    const refusal = (err) => ({code: typeof err?.code === "string" ? err.code : "",
      message: typeof err?.message === "string" ? err.message : String(err ?? "")});
    async function load() {
      const current = ++generation.current;
      setBusy(true);
      try { const data = await request("mods.list"); if (current === generation.current) {setAnswer(data); setError(null);} }
      catch (err) { if (current === generation.current) setError(refusal(err)); }
      finally { if (current === generation.current) setBusy(false); }
    }
    async function mutate(method, params) {
      setBusy(true); setError(null);
      try { await request(method, params); await load(); }
      catch (err) { setError(refusal(err)); }
      finally { setBusy(false); }
    }
    useEffect(() => { void load(); return () => { generation.current++; }; }, [api]);
    useEffect(() => api.subscribeExt?.(() => { void load(); }), [api]);
    const unsorted = groupMods(answer?.mods);
    const order = answer?.pending_order || answer?.order || unsorted.map(row=>row.id);
    const groups = unsorted.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    // "core" is the kernel itself, not an installed Mod, so it is the one name this file holds.
    const displayName=id=>id==="core"?t("core"):authored(groups.find(row=>row.id===id)?.versions[0]?.name,ui?.tag)||id;
    const slotName=key=>key.startsWith("audit:")?`${t("slot.audit")}: ${key.slice(6)}`
      :key.startsWith("check:")?`${t("slot.check")}: ${key.slice(6)}`:t(`slot.${key}`);
    function move(id, delta) {
      const next=[...order],index=next.indexOf(id),other=index+delta;
      if(index<0||other<0||other>=next.length)return;
      [next[index],next[other]]=[next[other],next[index]];
      void mutate("mods.order",{order:next});
    }
    // The landmark's name is this panel's own title once the words arrive; before that the region
    // stays unnamed rather than named in a language nobody has chosen (§23).
    return h("div", {className:"coc-mods", role:"region", ...(answer ? {"aria-label":t("title")} : {}),
      style:{padding:16, overflow:"auto", height:"100%", color:"var(--text)", fontSize:13}},
      h("div", {style:{display:"flex", justifyContent:"space-between", alignItems:"center"}},
        // Before the first answer there are no words yet, so the panel shows none.
        h("strong", {style:{fontSize:18}}, answer ? t("title") : "…"),
        h("button", {type:"button", onClick:()=>void load(), disabled:busy}, answer ? t("refresh") : "…")),
      answer && !answer.campaign && h("p", {style:{color:"var(--muted)"}}, t("unbound")),
      answer && h("p",{style:{color:"var(--muted)",fontSize:12,lineHeight:1.6}},t("orderHint")),
      answer?.pending_order && h("p",{role:"status",style:{color:"var(--accent)"}},t("pending")),
      error && h("p", {role:"alert", style:{color:"var(--danger)", overflowWrap:"anywhere"}}, said(error),
        error.message ? h("details", null, h("summary", null, word(ui,"errors","details")),
          h("p", null, error.message)) : null),
      busy && !answer && h("p", {role:"status"}, "…"),
      answer && !groups.length && h("p", null, t("empty")),
      ...groups.map(({id, versions}) => {
        const active = versions.find(v=>v.active)?.active;
        const row = versions.find(v=>v.version === (selected[id] ?? active?.version)) ?? versions.at(-1);
        const name = authored(row.name, ui?.tag) || id;
        const description = authored(row.description, ui?.tag);
        const displaced=Object.entries(answer?.providers||{}).filter(([,providers])=>providers.includes(id)&&providers.at(-1)!==id);
        return h("article", {key:id, style:{border:"1px solid var(--border)", borderRadius:8, padding:14, marginTop:14}},
          h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}},
            h("div",{style:{display:"flex",alignItems:"baseline",gap:8}},
              h("span",{"aria-label":t("order"),style:{color:"var(--muted)",fontSize:11}},String(order.indexOf(id)+1).padStart(2,"0")),h("strong",null,name)),
            h("div",{style:{display:"flex",gap:4}},
              h("button",{type:"button","aria-label":`${name} ${t("earlier")}`,disabled:busy||order.indexOf(id)<=0,onClick:()=>move(id,-1)},t("earlier")),
              h("button",{type:"button","aria-label":`${name} ${t("later")}`,disabled:busy||order.indexOf(id)>=order.length-1,onClick:()=>move(id,1)},t("later")))),
          ...displaced.map(([key,providers])=>h("p",{key,style:{fontSize:11,color:"var(--accent)",margin:"6px 0"}},`${slotName(key)} · ${t("overridden")}: ${displayName(providers.at(-1))}`)),
          h("p", {style:{color:"var(--muted)", lineHeight:1.6}}, description),
          h("div", {style:{display:"flex", gap:8, alignItems:"center", marginBottom:10}},
            h("label", null, t("version"), " ", h("select", {"aria-label":`${name} ${t("version")}`, disabled:busy,
              value:row.version, onChange:e=>setSelected(s=>({...s,[id]:e.target.value}))},
              ...versions.map(v=>h("option", {key:v.version, value:v.version}, v.version)))),
            h("span", {style:{color:"var(--subtle)"}}, row.author)),
          !row.compatible && h("p", {role:"status"}, t("incompatible")),
          h("label", {style:{display:"block", marginBottom:8}},
            h("input", {type:"checkbox", checked:!!active?.enabled, disabled:busy || !answer.campaign || !row.compatible,
              onChange:e=>void mutate("mods.configure", {id, version:row.version, enabled:e.target.checked})}), " ", t("campaign")),
          h("label", {style:{display:"block", marginBottom:8}},
            h("input", {type:"checkbox", checked:row.default_enabled, disabled:busy || !row.compatible,
              onChange:e=>void mutate("mods.defaults", {id, enabled:e.target.checked})}), " ", t("defaults")),
          active && active.version !== row.version && h("button", {type:"button", disabled:busy || !row.compatible,
            onClick:()=>void mutate("mods.configure", {id, version:row.version})}, t("update")),
          row.pending && h("p", {role:"status", style:{color:"var(--accent)"}}, t("pending")),
          h("details", null, h("summary", {style:{cursor:"pointer", color:"var(--muted)"}}, t("settings")),
            ...Object.entries(row.settings ?? {}).map(([key, fallback]) => {
              const current = active?.version === row.version ? (active.settings?.[key] ?? fallback) : fallback;
              const schema = row.settings_schema?.[key] ?? {};
              const change = value => void mutate("mods.configure", {id, version:row.version,
                settings:{...row.settings, ...(active?.version === row.version ? active.settings : {}), [key]:value}});
              const attributes = {"aria-label":key, disabled:busy || !answer.campaign, style:{maxWidth:"100%"}};
              // A setting's caption belongs to the Mod that declares it, so it comes from JSON
              // Schema's own `title` -- a string, or per-language like the Mod's name. The key is
              // the visible gap for a Mod that authored none; this panel may not invent one, and a
              // per-Mod table here is the very thing that left every third Mod in English.
              const caption = authored(schema.title, ui?.tag) || key;
              return h("label", {key, style:{display:"block", marginTop:10}}, caption, " ",
                schema.enum ? h("select", {...attributes, value:current, onChange:e=>change(typeof fallback === "number" ? Number(e.target.value) : e.target.value)},
                  ...schema.enum.map(value=>h("option", {key:String(value),value}, String(value))))
                : typeof fallback === "boolean" ? h("input", {...attributes,type:"checkbox",checked:current,onChange:e=>change(e.target.checked)})
                : h("input", {...attributes,type:typeof fallback === "number" ? "number" : "text",defaultValue:current,
                    min:schema.minimum,max:schema.maximum,onBlur:e=>{const value=typeof fallback === "number" ? Number(e.target.value) : e.target.value; if(value!==current)change(value);}}));
            }),
            h("p", {style:{whiteSpace:"pre-wrap"}}, description)));
      }),
      answer && h("button", {type:"button", style:{marginTop:16}, onClick:()=>setImporting(v=>!v)}, t("install")),
      importing && h("form", {style:{display:"flex", flexDirection:"column", gap:8, marginTop:12},
        onSubmit:e=>{e.preventDefault(); void mutate("mods.install", {path});}},
        h("input", {"aria-label":t("path"), placeholder:t("path"), value:path, onChange:e=>setPath(e.target.value), disabled:busy}),
        h("button", {type:"submit", disabled:busy || !path.trim()}, t("add"))));
  };
}
