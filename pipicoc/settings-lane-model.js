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
      })();
      return () => { generation.current++; };
    }, [api, host]);

    function choose(reference) {
      setCurrent(reference);
      setFailed(false);
      if (!host || !host.updateExtensionSettings) return;
      void host.updateExtensionSettings(SETTINGS_EXTENSION, { [SETTINGS_KEY]: reference ? { model: reference } : {} })
        .then((result) => { if (result && result.ok === false) setFailed(true); })
        .catch(() => setFailed(true));
    }

    if (current === undefined) return h("div", { className: "model-modal-state" }, t("lead"));

    const rows = [
      { key: "auto", title: t("auto_title"), subtitle: t("auto_subtitle"), selected: current === null, pick: () => choose(null) },
      ...models.map((model) => {
        const reference = `${model.provider}/${model.id}`;
        return { key: reference, title: model.name || model.id, subtitle: reference,
          selected: current === reference, pick: () => choose(reference) };
      }),
    ];

    return h("div", { className: "model-visibility" },
      h("p", { className: "model-modal-state" }, t("lead")),
      h("p", { className: "model-modal-state" }, t("aside")),
      failed ? h("div", { className: "model-modal-error", role: "alert" }, t("failed")) : null,
      models.length
        ? h("div", null, rows.map((row) => h("button", {
            key: row.key, type: "button", className: "model-row", "aria-pressed": row.selected,
            "data-testid": `lane-model-row-${row.key}`, onClick: row.pick,
            style: { display: "flex", width: "100%", gap: "8px", alignItems: "baseline", cursor: "pointer",
              background: "none", border: 0, padding: "6px 4px", textAlign: "left", font: "inherit" },
          },
            h("input", { type: "radio", checked: row.selected, readOnly: true, "aria-label": row.title }),
            h("span", { className: "model-row-name" }, row.title),
            h("span", { className: "model-row-id" }, row.subtitle),
            row.selected ? h("span", { className: "model-row-current" }, t("current")) : null)))
        : h("div", { className: "model-modal-state" }, t("empty")));
  };
}
