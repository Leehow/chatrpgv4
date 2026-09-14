/**
 * The COC Keeper extension's lane-model settings section.
 *
 * The Keeper's background lanes -- the child that writes an item's parameters, and the one that
 * audits an unpublished draft -- followed whatever model the table was set to, and a slow one
 * costs the player the turn: one audit on record spent fifty of its fifty-eight seconds inside a
 * single model turn. `PI_COC_MOD_MODEL` could already redirect them, but an environment variable
 * is a setting nobody can see, so this is the same choice where the other model choices live.
 *
 * Plain ESM with no imports, on purpose: the renderer imports this file as a module and calls
 * `createComponent(React)` with its own React instance, the same shape as settings-difficulty.js.
 *
 * THE CHROME IS DATA TOO (contract §23). This file keeps no word table: the words arrive from the
 * host's `ui-words` answer (`ui.words['lane-model']`, read from content/ui/<tag>/lane-model.json),
 * and a key the surface lacks renders as the key, because an identifier is a visible gap and
 * another language's word is a silent one.
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

/** A caption from the answer's `ui` block, or the key itself: a visible gap, never another language. */
function word(ui, key) {
  const table = ui && typeof ui === "object" && ui.words && typeof ui.words === "object" ? ui.words["lane-model"] : undefined;
  const value = table && typeof table === "object" ? table[key] : undefined;
  return typeof value === "string" ? value : key;
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

  return function LaneModelSection(props) {
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
      { key: "auto", title: t("thinking_auto_title"), subtitle: t("thinking_auto_subtitle"),
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
