/**
 * The Image Generation settings section: credential-backed image options from the
 * pi-backend app-level image-gen/model invoke, persisted through the same invoke
 * branch into <agentDir>/image-model.json — the file the agent reads per generation call.
 *
 * Loaded as a data: module (no relative imports). The host owns the catalog and
 * shares the automatic provider policy with the agent dispatch.
 */

export function createComponent(React) {
  const { useCallback, useEffect, useState } = React;
  const h = React.createElement;

  return function ImageModelSection(props) {
    const api = props.api;
    const selectedProvider = props.ctx?.current?.provider;
    const selectedId = props.ctx?.current?.id;
    const selectedParams = () => selectedProvider && selectedId
      ? { selectedModel: { provider: selectedProvider, id: selectedId } } : {};
    const [state, setState] = useState(undefined);
    const [error, setError] = useState(null);

    const refresh = useCallback(async (active) => {
      if (!api.invoke) { setError("invoke"); return; }
      try {
        const result = await api.invoke("model", { op: "get", ...selectedParams() });
        if (!active()) return;
        if (result && result.ok && result.data) { setState(result.data); setError(null); }
        else setError("get");
      } catch { if (active()) setError("get"); }
    }, [api, selectedProvider, selectedId]);
    useEffect(() => {
      let active = true;
      void refresh(() => active);
      return () => { active = false; };
    }, [refresh]);

    const choose = async (op, model) => {
      if (!api.invoke) return;
      try {
        const result = await api.invoke("model", { ...(op === "set" ? { op, model } : { op }), ...selectedParams() });
        if (result && result.ok && result.data) { setState(result.data); setError(null); }
        else setError(op);
      } catch { setError(op); }
    };

    if (state === undefined && !error) {
      return h("div", { className: "model-modal-state" }, "Loading image model settings…");
    }

    const current = state && typeof state.current === "string" ? state.current : null;
    const models = Array.isArray(state?.models) ? state.models : [];
    const rows = [
      {
        key: "auto",
        title: "Automatic",
        subtitle: state?.autoModel
          ? `Follows the selected chat model's provider: ${state.autoModel}`
          : "No image model is available for the selected provider; configure its credentials or choose a model below",
        selected: current === null,
        pick: () => void choose("clear"),
      },
      ...models.map((model) => {
        const ref = `${model.provider}/${model.id}`;
        return {
          key: ref,
          title: model.name || model.id,
          subtitle: ref,
          selected: current === ref || current === model.id,
          pick: () => void choose("set", ref),
        };
      }),
    ];

    return h("div", { className: "model-visibility" },
      h("p", { className: "model-modal-state" },
        "Pick the image model for investigator portraits and illustrations. The portrait frame, /image, and generate_image share this one choice."),
      error ? h("div", { className: "model-modal-error", role: "alert" }, "Reading or writing the image model setting failed; try again.") : null,
      h("div", null, rows.map((row) => h("button", {
            key: row.key,
            type: "button",
            className: "model-row",
            "aria-pressed": row.selected,
            "data-testid": `image-model-row-${row.key}`,
            onClick: row.pick,
            style: { display: "flex", width: "100%", gap: "8px", alignItems: "baseline", cursor: "pointer", background: "none", border: 0, padding: "6px 4px", textAlign: "left", font: "inherit" },
          },
            h("input", { type: "radio", checked: row.selected, readOnly: true, "aria-label": row.title }),
            h("span", { className: "model-row-name" }, row.title),
            h("span", { className: "model-row-id" }, row.subtitle),
            row.selected ? h("span", { className: "model-row-current" }, "Current") : null))),
      rows.length === 1 ? h("div", { className: "model-modal-state" },
        "No image models are available yet. Configure provider credentials in Model Management, then come back.") : null);
  };
}
