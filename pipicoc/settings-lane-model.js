/**
 * The COC Keeper extension's fast-model settings section (contract §37.10.1).
 *
 * Product owner's ruling, 2026-09-23: this is not a "review model" -- it is the fast model, and
 * everything that has to be fast uses it. One quick model for all of the Keeper's background work:
 * an item's parameters, continuity reviews, journals, memory, the verifier, voices, the projected
 * words of the interface and the cards, adaptations, and prefetched usages. Nothing those lanes write
 * is the Keeper's prose, and a slow one costs the player the turn: one audit on record spent fifty of
 * its fifty-eight seconds inside a single model turn. "Follow the table" is the unchosen row: every
 * such lane then runs on the Keeper's own model, as before. The stored keys keep their pre-rename
 * names (`ext.coc-keeper.laneModel` / `ext.coc-keeper.laneThinking`) so existing choices survive.
 *
 * Plain ESM with no imports, on purpose: the renderer imports this file as a module and calls
 * `createComponent(React)` with its own React instance, the same shape as settings-difficulty.js.
 *
 * THE CHROME IS DATA TOO (contract §23). This file keeps no word table: the words arrive from the
 * host's `ui-words` answer (`ui.words['lane-model']`, read from content/ui/<tag>/lane-model.json),
 * and a key the surface lacks renders as the key, because an identifier is a visible gap and
 * another language's word is a silent one. The sidebar entry's own name comes from the same surface
 * (`sectionCaptions`), so the settings list says "fast model" in the player's language rather than
 * a caption written by hand into the manifest.
 */

export const SETTINGS_EXTENSION = "coc-keeper";
export const SETTINGS_KEY = "ext.coc-keeper.laneModel";
export const SETTINGS_THINKING_KEY = "ext.coc-keeper.laneThinking";

/**
 * Choosing the lane's model without its reasoning effort only half-separates it from the table: the
 * lane kept riding the Keeper's own chip, so a table set to `high` ran its continuity review at `high`
 * too and one review spent its entire budget inside a thinking stream it never finished. The levels
 * are the runtime's own identifiers, shown as written — a caption we invented here would be a word
 * table in a file that has no right to one.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * What the lanes run at when nothing is chosen here (contract §37.11). The runtime owns this value
 * (`LANE_THINKING_DEFAULT` in `runtime/fast-model.ts`); the copy exists so the panel can show what the
 * unchosen row actually does, and `tests/extension/coc-lane-model.test.mjs` pins the two together.
 *
 * The unchosen row used to mean "follow the table", and that is the configuration that killed two
 * campaigns in one day. Following the table is no longer reachable at all — not as a row, not as a
 * stored value. Every level it could have produced is directly selectable above, so it added no
 * capability; its one distinctive behaviour was to change under the operator when the table's effort
 * changed, which is precisely the failure. A choice whose only special power is to go wrong later is
 * not a choice worth keeping.
 */
export const LANE_THINKING_DEFAULT = "low";

/** A caption from the answer's `ui` block, or the key itself: a visible gap, never another language. */
function word(ui, key) {
  const table = ui && typeof ui === "object" && ui.words && typeof ui.words === "object" ? ui.words["lane-model"] : undefined;
  const value = table && typeof table === "object" ? table[key] : undefined;
  return typeof value === "string" ? value : key;
}

/**
 * The sidebar entry's name, hint and header line, from the same surface as the section's own words.
 *
 * The host's loader asks a settings section for these once it has loaded the entry; without an answer
 * it keeps the manifest's English title. Nothing here names a language: the host answers `ui-words` in
 * the table's default play language and a projected tag arrives the same way every other caption does.
 */
export async function sectionCaptions(api) {
  if (!api || typeof api.invoke !== "function") return undefined;
  const answer = await api.invoke("ui-words", {}).catch(() => undefined);
  const ui = answer && answer.ok && answer.data ? answer.data.ui : undefined;
  if (!ui) return undefined;
  const t = (key) => word(ui, key);
  return { label: t("section_title"), hint: t("section_hint"), description: t("section_description") };
}

/** `provider/id`, which is what the runtime hands the child; anything else is not a choice. */
export function modelReference(setting) {
  return setting && typeof setting === "object" && typeof setting.model === "string" && setting.model.trim()
    ? setting.model.trim() : null;
}

/** One of the runtime's levels, which is what the child is handed; anything else is not a choice. */
export function thinkingReference(setting) {
  const level = setting && typeof setting === "object" && typeof setting.level === "string" ? setting.level.trim() : "";
  return THINKING_LEVELS.includes(level) ? level : null;
}

export const AUTHOR_MODEL_KEY = "ext.coc-keeper.authorModel";
export const AUTHOR_THINKING_KEY = "ext.coc-keeper.authorThinking";
export const AUTHOR_DEFAULT = {model: "opencode-go/deepseek-v4.1-flash", thinking: "off"};

export function createComponent(React) {
  const h = React.createElement;
  const {useEffect, useRef, useState} = React;
  return function ModelSettingsSection(props) {
    const api = props.api ?? {}, ctx = props.ctx ?? {}, host = ctx.host;
    const models = ctx.visibility?.models ?? [];
    const [ui, setUi] = useState(undefined), [stored, setStored] = useState(null);
    const [failed, setFailed] = useState(false), [saving, setSaving] = useState(false);
    const generation = useRef(0);
    const t = key => word(ui, key);
    useEffect(() => {
      const mine = ++generation.current;
      (async () => {
        try {
          const answer = await api.invoke?.("ui-words", {});
          const values = await host?.getExtensionSettings?.(SETTINGS_EXTENSION);
          if (mine !== generation.current) return;
          setUi(answer?.data?.ui); setStored(values ?? {});
        } catch { if (mine === generation.current) setFailed(true); }
      })();
      return () => { generation.current++; };
    }, [api, host]);
    async function write(patch) {
      if (!host?.updateExtensionSettings || saving) return;
      const previous = stored;
      setStored({...stored, ...patch}); setSaving(true); setFailed(false);
      try {
        const result = await host.updateExtensionSettings(SETTINGS_EXTENSION, patch);
        if (result?.ok === false) throw Error("Settings write failed");

      } catch { setStored(previous); setFailed(true); }
      finally { setSaving(false); }
    }
    if (!stored) return h("div", {className:"model-modal-state"}, failed ? t("failed") : t("lead"));
    const role = (name, modelKey, thinkingKey, fallback, defaultLevel) => {
      const reference = modelReference(stored[modelKey]);
      const selected = models.find(m => m.provider + "/" + m.id === (reference ?? fallback));
      const allowed = selected && ctx.thinkingLevelsForModel ? ctx.thinkingLevelsForModel(selected) : [];
      const requested = thinkingReference(stored[thinkingKey]);
      const effective = allowed.includes(requested) ? requested : allowed.includes(defaultLevel) ? defaultLevel : allowed[0] ?? "";
      const chooseModel = event => {
        const next = event.target.value;
        const model = models.find(m => m.provider + "/" + m.id === (next || fallback));
        const levels = model && ctx.thinkingLevelsForModel ? ctx.thinkingLevelsForModel(model) : [];
        const level = levels.includes(requested) ? requested : levels.includes(defaultLevel) ? defaultLevel : levels[0];
        void write({[modelKey]:next ? {model:next} : {}, [thinkingKey]:level ? {level} : {}});
      };
      const missing = reference && !models.some(m => m.provider + "/" + m.id === reference);
      return h("fieldset", {className:"settings-group settings-model-role", disabled:saving},
        h("legend", {className:"settings-group-title"}, t(name === "fast" ? "fast_title" : "author_title")),
        h("p", {className:"settings-description"}, t(name === "fast" ? "fast_description" : "author_description")),
        h("div", {className:"settings-model-fields"}, h("label", {className:"settings-field"}, t("model_label"),
          h("select", {"aria-label":t(name === "fast" ? "fast_title" : "author_title"), "data-testid":name+"-model-select", value:reference ?? "", onChange:chooseModel, className:"settings-control"},
            h("option", {value:""}, name === "fast" ? t("auto_title") : t("author_default") + " · " + AUTHOR_DEFAULT.model),
            missing ? h("option", {value:reference}, reference + " · " + t("unavailable")) : null,
            ...models.map(m => {const ref=m.provider+"/"+m.id;return h("option",{key:ref,value:ref},(m.name||m.id)+" · "+m.provider);}))),
        h("label", {className:"settings-field"}, t("thinking_label"),
          h("select", {"aria-label":t(name === "fast" ? "fast_thinking" : "author_thinking"), "data-testid":name+"-thinking-select", value:effective, disabled:!allowed.length||saving,
            onChange:event => void write({[thinkingKey]:{level:event.target.value}}), className:"settings-control"},
            !allowed.length ? h("option",{value:""},t("model_controlled")) : allowed.map(level=>h("option",{key:level,value:level},level))))));
    };
    const table = ctx.current ? ctx.current.provider+"/"+ctx.current.id : undefined;
    return h("div", {className:"model-visibility settings-models"},
      h("p",{className:"settings-description"},t("lead")),
      h("p",{className:"settings-note"},t("live")),
      failed ? h("div",{role:"alert",className:"model-modal-error"},t("failed")) : null,
      role("fast",SETTINGS_KEY,SETTINGS_THINKING_KEY,table,LANE_THINKING_DEFAULT),
      role("author",AUTHOR_MODEL_KEY,AUTHOR_THINKING_KEY,AUTHOR_DEFAULT.model,AUTHOR_DEFAULT.thinking));
  };
}
