/**
 * The beginner-hints settings section (docs/specs/opening-guidance.md §4): one checkbox that decides
 * whether the short explanation behind a "?" opens by itself the first time this desk meets a moment
 * a new player may not understand. Off leaves every "?" in place and opens nothing.
 *
 * Plain ESM with no imports, the shape of settings-lane-model.js: the renderer calls
 * `createComponent(React)` with its own React. The words come from the host's `ui-words` answer
 * (`ui.words.hints`, read from content/ui/<tag>/hints.json); a key the surface lacks renders as
 * the key. The value lives in the host's extension settings document, never in browser storage.
 */

export const SETTINGS_EXTENSION = "coc-keeper";
export const SETTINGS_KEY = "ext.coc-keeper.beginnerHints";

/** A caption from the answer's `ui` block, or the key itself: a visible gap, never another language. */
function word(ui, key) {
  const table = ui && typeof ui === "object" && ui.words && typeof ui.words === "object" ? ui.words.hints : undefined;
  const value = table && typeof table === "object" ? table[key] : undefined;
  return typeof value === "string" ? value : key;
}

/** On unless the stored value says `{enabled: false}`; anything else is the default. */
export function hintsEnabledFrom(setting) {
  return !(setting && typeof setting === "object" && setting.enabled === false);
}

export function createComponent(React) {
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;

  return function HintsSection(props) {
    const api = props.api ?? {};
    const host = props.ctx && props.ctx.host;
    const [ui, setUi] = useState(undefined);
    const [enabled, setEnabled] = useState(undefined);
    const [failed, setFailed] = useState(false);
    const generation = useRef(0);
    const t = (key) => word(ui, key);

    useEffect(() => {
      const mine = ++generation.current;
      (async () => {
        let words;
        if (api.invoke) {
          const answer = await api.invoke("ui-words", {}).catch(() => undefined);
          if (answer && typeof answer === "object" && answer.ui) words = answer.ui;
        }
        let stored;
        if (host && host.getExtensionSettings) stored = await host.getExtensionSettings(SETTINGS_EXTENSION).catch(() => undefined);
        if (mine !== generation.current) return;
        setUi(words);
        setEnabled(hintsEnabledFrom(stored && stored[SETTINGS_KEY]));
      })();
      return () => { generation.current++; };
    }, [api, host]);

    function choose(next) {
      setEnabled(next);
      setFailed(false);
      if (!host || !host.updateExtensionSettings) return;
      void host.updateExtensionSettings(SETTINGS_EXTENSION, { [SETTINGS_KEY]: { enabled: next } })
        .then((result) => { if (result && result.ok === false) setFailed(true); })
        .catch(() => setFailed(true));
    }

    if (enabled === undefined) return h("div", { className: "model-modal-state" }, t("lead"));
    return h("div", { className: "model-visibility", "data-testid": "coc-hints-section" },
      h("p", { className: "model-modal-state" }, t("lead")),
      h("label", { style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 4px", cursor: "pointer" } },
        h("input", { type: "checkbox", checked: enabled, "data-testid": "coc-hints-enabled", onChange: (event) => choose(!!event.target.checked) }),
        h("span", null, t("enabled"))),
      failed ? h("p", { className: "model-modal-state", role: "alert" }, t("failed")) : null);
  };
}
