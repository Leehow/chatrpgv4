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

export function createComponent(React) {
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;

  return function FastModelSection(props) {
    const api = props.api ?? {};
    const host = props.ctx && props.ctx.host;
    const visibility = props.ctx && props.ctx.visibility;
    const models = visibility && Array.isArray(visibility.models) ? visibility.models : [];
    const [ui, setUi] = useState(undefined);
    const [current, setCurrent] = useState(undefined);
    const [thinking, setThinking] = useState(undefined);
    const [failed, setFailed] = useState(false);
    const generation = useRef(0);
    const t = (key) => word(ui, key);

    useEffect(() => {
      const mine = ++generation.current;
      (async () => {
        let words;
        if (api.invoke) {
          const answer = await api.invoke("ui-words", {}).catch(() => undefined);
          if (answer && answer.ok && answer.data && answer.data.ui) words = answer.data.ui;
        }
        let stored;
        if (host && host.getExtensionSettings) stored = await host.getExtensionSettings(SETTINGS_EXTENSION).catch(() => undefined);
        if (mine !== generation.current) return;
        setUi(words);
        setCurrent(modelReference(stored && stored[SETTINGS_KEY]));
        setThinking(thinkingReference(stored && stored[SETTINGS_THINKING_KEY]));
      })();
      return () => { generation.current++; };
    }, [api, host]);

    function write(key, value, apply) {
      apply();
      setFailed(false);
      if (!host || !host.updateExtensionSettings) return;
      void host.updateExtensionSettings(SETTINGS_EXTENSION, { [key]: value })
        .then((result) => { if (result && result.ok === false) setFailed(true); })
        .catch(() => setFailed(true));
    }
    const choose = (reference) => write(SETTINGS_KEY, reference ? { model: reference } : {}, () => setCurrent(reference));
    const chooseThinking = (level) => write(SETTINGS_THINKING_KEY, level ? { level } : {}, () => setThinking(level));

    if (current === undefined || thinking === undefined) return h("div", { className: "model-modal-state" }, t("lead"));

    const rows = [
      { key: "auto", title: t("auto_title"), subtitle: t("auto_subtitle"), selected: current === null, pick: () => choose(null) },
      ...models.map((model) => {
        const reference = `${model.provider}/${model.id}`;
        return { key: reference, title: model.name || model.id, subtitle: reference,
          selected: current === reference, pick: () => choose(reference) };
      }),
    ];
    const thinkingRows = [
      // The unchosen row shows the level it actually runs at, the way every other row shows its own:
      // a subtitle saying "follow the table" is how nobody noticed the table was being followed.
      { key: "auto", title: t("thinking_auto_title"), subtitle: LANE_THINKING_DEFAULT,
        selected: thinking === null, pick: () => chooseThinking(null) },
      ...THINKING_LEVELS.map((level) => ({ key: level, title: level, subtitle: "",
        selected: thinking === level, pick: () => chooseThinking(level) })),
    ];
    const group = (prefix, list) => h("div", null, list.map((row) => h("button", {
      key: row.key, type: "button", className: "model-row", "aria-pressed": row.selected,
      "data-testid": `${prefix}-row-${row.key}`, onClick: row.pick,
      style: { display: "flex", width: "100%", gap: "8px", alignItems: "baseline", cursor: "pointer",
        background: "none", border: 0, padding: "6px 4px", textAlign: "left", font: "inherit" },
    },
      h("input", { type: "radio", checked: row.selected, readOnly: true, "aria-label": row.title }),
      h("span", { className: "model-row-name" }, row.title),
      row.subtitle ? h("span", { className: "model-row-id" }, row.subtitle) : null,
      row.selected ? h("span", { className: "model-row-current" }, t("current")) : null)));

    return h("div", { className: "model-visibility" },
      h("p", { className: "model-modal-state" }, t("lead")),
      h("p", { className: "model-modal-state" }, t("aside")),
      // Both choices are read when a lane starts a child, not when the session does. They used to be
      // read at spawn, and a person who changed the model under a running table watched it fail exactly
      // as before and concluded the faster model had not helped -- the setting was correct, visible and
      // inert. This line says what the reader now actually does (contract §37.10).
      h("p", { className: "model-modal-state" }, t("live")),
      failed ? h("div", { className: "model-modal-error", role: "alert" }, t("failed")) : null,
      models.length ? group("lane-model", rows) : h("div", { className: "model-modal-state" }, t("empty")),
      h("p", { className: "model-modal-state" }, t("thinking_lead")),
      group("lane-thinking", thinkingRows));
  };
}
