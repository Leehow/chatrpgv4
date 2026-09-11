/**
 * The Image Generation settings section: pick the image model from the same catalog 模型管理
 * shows (props.ctx.visibility), persisted through the pi-backend app-level image-gen/model
 * branch into <agentDir>/image-model.json — the file the agent reads per generation call.
 *
 * Loaded as a data: module (no relative imports), so the image-family predicate below mirrors
 * the closed vendor map in ../agent/vendors.js routeByModelId. Keep the two in sync; the map is
 * a closed word list (contract enum), not a semantic classifier.
 */
function isImageModelId(modelId) {
  const id = String(modelId ?? "").toLowerCase();
  if (!id) return false;
  if (id.includes("gpt-image") || id.includes("dall-e")) return true;
  if (id.includes("seedream") || id.includes("seededit")) return true;
  if (id.includes("qwen-image")) return true;
  if (id.includes("grok") && id.includes("image")) return true;
  if (id.includes("gemini") && id.includes("image")) return true;
  if (id.includes("wan")) return true;
  return false;
}

export function createComponent(React) {
  const { useCallback, useEffect, useState } = React;
  const h = React.createElement;

  return function ImageModelSection(props) {
    const api = props.api;
    const visibility = props.ctx && props.ctx.visibility;
    const models = (visibility && Array.isArray(visibility.models) ? visibility.models : [])
      .filter((model) => isImageModelId(model && model.id));
    const [state, setState] = useState(undefined);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
      if (!api.invoke) { setError("invoke"); return; }
      const result = await api.invoke("model", { op: "get" });
      if (result && result.ok && result.data) setState(result.data);
      else setError("get");
    }, [api]);
    useEffect(() => { void refresh(); }, [refresh]);

    const choose = async (op, model) => {
      if (!api.invoke) return;
      const result = await api.invoke("model", op === "set" ? { op, model } : { op });
      if (result && result.ok && result.data) setState(result.data);
      else setError(op);
    };

    if (state === undefined && !error) {
      return h("div", { className: "model-modal-state" }, "正在读取生图模型设置…");
    }

    const current = state && typeof state.current === "string" ? state.current : null;
    const grokDefault = Boolean(state && state.grokDefault);
    const rows = [
      {
        key: "auto",
        title: "自动",
        subtitle: grokDefault ? "grok-build 已登录，默认使用 grok-build 出图" : "未选择模型；grok-build 登录后自动用它出图",
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
        "选择调查员证件照与插图使用的生图模型。证件照片框、/image 与 generate_image 共用这一个选择。"),
      error ? h("div", { className: "model-modal-error", role: "alert" }, "生图模型设置读写失败，请重试。") : null,
      rows.length > 1 || models.length
        ? h("div", null, rows.map((row) => h("button", {
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
            row.selected ? h("span", { className: "model-row-current" }, "当前") : null)))
        : h("div", { className: "model-modal-state" },
            "模型管理里还没有可用的生图模型。先在模型管理登录支持生图的 provider（如 grok-build），再回到这里。"));
  };
}
