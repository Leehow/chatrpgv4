/**
 * The Rerank settings section: pick a provider, paste its key, choose which of that provider's
 * models to call.
 *
 * Loaded as a data: module (no relative imports), so `PROVIDER_PRESETS` below mirrors the closed
 * vendor map in `../agent/vendors.js`. Keep the two in sync; `tests/extension/rerank.test.mjs`
 * imports both and fails if they drift — the map is a closed word list (contract enum), not a
 * semantic classifier, and the model list is the vendor's own published catalogue rather than a
 * live fetch: a live one would have to run where the key is, which is the agent process, and a
 * key only reaches that process when a session starts.
 *
 * Nothing here is a second settings store: values go through the host's
 * `getExtensionSettings` / `updateExtensionSettings`, and the key rides that same call as a
 * `format: "secret"` property, which is why the host answers with its presence and never with
 * its value.
 *
 * Three rules this file learned the hard way (2026-09-19), all three about the key field:
 *   - A secret is written when it is *committed* (blur or Enter), never per keystroke. The host
 *     refuses a secret shorter than eight characters, so a per-keystroke write failed six times
 *     on the way to a valid key and then raced its own success.
 *   - Only the newest write may raise the banner. Replies arrive out of order; without the
 *     generation guard a stale failure sticks to a written value and the pane cries wolf.
 *   - A refusal is shown with the host's own code and sentence. A generic "it failed" hides the
 *     one line that says why, which is the whole reason the host bothered to send it.
 */

/** Mirrors `RERANK_PROVIDERS` in ../agent/vendors.js. */
export const PROVIDER_PRESETS = [
  {
    id: "cohere",
    label: "Cohere",
    baseUrl: "https://api.cohere.com",
    defaultModel: "rerank-v4.0-fast",
    models: ["rerank-v4.0-fast", "rerank-v4.0-pro", "rerank-v3.5", "rerank-english-v3.0", "rerank-multilingual-v3.0"],
  },
  {
    id: "qwen",
    label: "Alibaba Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com",
    defaultModel: "qwen3-rerank",
    models: ["qwen3-rerank"],
  },
  {
    id: "jina",
    label: "Jina AI",
    baseUrl: "https://api.jina.ai",
    defaultModel: "jina-reranker-v3.5",
    models: ["jina-reranker-v3.5", "jina-reranker-v3", "jina-reranker-m0", "jina-reranker-v2-base-multilingual"],
  },
  {
    id: "voyage",
    label: "Voyage AI",
    baseUrl: "https://api.voyageai.com",
    defaultModel: "rerank-2.5",
    models: ["rerank-2.5", "rerank-2.5-lite"],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.com",
    defaultModel: "Qwen/Qwen3-Reranker-8B",
    models: ["Qwen/Qwen3-Reranker-8B", "Qwen/Qwen3-Reranker-4B", "Qwen/Qwen3-Reranker-0.6B", "BAAI/bge-reranker-v2-m3"],
  },
  {
    id: "zeroentropy",
    label: "ZeroEntropy",
    baseUrl: "https://api.zeroentropy.dev",
    defaultModel: "zerank-2",
    models: ["zerank-2", "zerank-1", "zerank-1-small"],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai",
    defaultModel: "fireworks/qwen3-reranker-8b",
    models: ["fireworks/qwen3-reranker-8b"],
  },
  {
    id: "pinecone",
    label: "Pinecone",
    baseUrl: "https://api.pinecone.io",
    defaultModel: "bge-reranker-v2-m3",
    models: ["bge-reranker-v2-m3", "pinecone-rerank-v0", "cohere-rerank-4-fast"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai",
    defaultModel: "cohere/rerank-v3.5",
    models: ["cohere/rerank-v3.5", "voyage/rerank-2.5"],
  },
];

export const SETTINGS_EXTENSION = "rerank";
export const PROVIDER_KEY = "ext.rerank.provider";
export const MODEL_KEY = "ext.rerank.model";
export const API_KEY_KEY = "ext.rerank.apiKey";

const ROW = { display: "flex", flexDirection: "column", gap: "4px", margin: "10px 0" };
const LABEL = { fontWeight: 600 };
const CONTROL = {
  font: "inherit", padding: "6px 8px", borderRadius: "6px",
  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", background: "transparent", color: "inherit",
};

/** The preset a stored provider id names, or the first one: an unknown id is not a choice to keep. */
function presetFor(id) {
  return PROVIDER_PRESETS.find((entry) => entry.id === id) ?? PROVIDER_PRESETS[0];
}

export function createComponent(React) {
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;

  return function RerankSection(props) {
    const host = props.ctx && props.ctx.host;
    const [stored, setStored] = useState(undefined);
    const [draftKey, setDraftKey] = useState("");
    const [failure, setFailure] = useState(null);
    const generation = useRef(0);

    useEffect(() => {
      const mine = ++generation.current;
      (async () => {
        let values;
        if (host && host.getExtensionSettings) {
          values = await host.getExtensionSettings(SETTINGS_EXTENSION).catch(() => undefined);
        }
        if (mine !== generation.current) return;
        setStored(values && typeof values === "object" ? values : {});
      })();
      return () => { generation.current++; };
    }, [host]);

    /**
     * Write a patch and let the newest write own the outcome. `apply` is the optimistic half:
     * the control moves on the spot, and the banner follows the last reply, whatever order the
     * earlier ones arrive in.
     */
    function write(patch, apply) {
      apply();
      const mine = ++generation.current;
      setFailure(null);
      if (!host || !host.updateExtensionSettings) return Promise.resolve();
      return Promise.resolve(host.updateExtensionSettings(SETTINGS_EXTENSION, patch))
        .then((result) => {
          if (mine !== generation.current) return;
          if (result && result.ok === false) {
            const error = result.error ?? {};
            setFailure({ code: error.code ?? "refused", message: error.message ?? "the host refused the write" });
          }
        })
        .catch((error) => {
          if (mine === generation.current) setFailure({ code: "unreachable", message: String((error && error.message) || error) });
        });
    }

    /** The key is written here and only here: a half-typed secret is not a secret to store. */
    function commitKey() {
      const value = draftKey.trim();
      if (!value) return;
      return write({ [API_KEY_KEY]: value }, () => {
        setStored({ ...stored, [API_KEY_KEY]: true });
        setDraftKey("");
      });
    }

    if (stored === undefined) return h("div", { className: "model-modal-state" }, "Loading rerank settings…");

    const providerId = typeof stored[PROVIDER_KEY] === "string" ? stored[PROVIDER_KEY] : PROVIDER_PRESETS[0].id;
    const preset = presetFor(providerId);
    const chosenModel = typeof stored[MODEL_KEY] === "string" && stored[MODEL_KEY] ? stored[MODEL_KEY] : preset.defaultModel;
    const keyPresent = stored[API_KEY_KEY] === true || (typeof stored[API_KEY_KEY] === "string" && stored[API_KEY_KEY].length > 0);

    return h("div", { className: "model-visibility" },
      h("p", { className: "model-modal-state" },
        "Re-ranking orders candidate passages against a query. The provider choice fixes the endpoint; the model list below is that provider's own rerank catalogue."),
      failure ? h("div", { className: "model-modal-error", role: "alert", "data-testid": "rerank-failure" },
        `Saving failed — ${failure.code}: ${failure.message}`) : null,

      h("div", { style: ROW },
        h("label", { style: LABEL, htmlFor: "rerank-provider" }, "Provider"),
        h("select", {
          id: "rerank-provider", style: CONTROL, value: preset.id, "data-testid": "rerank-provider",
          onChange: (event) => {
            const next = presetFor(event.target.value);
            write({ [PROVIDER_KEY]: next.id, [MODEL_KEY]: next.defaultModel }, () => {
              setStored({ ...stored, [PROVIDER_KEY]: next.id, [MODEL_KEY]: next.defaultModel });
            });
          },
        }, PROVIDER_PRESETS.map((entry) => h("option", { key: entry.id, value: entry.id }, `${entry.label} (${entry.id})`))),
        h("span", { className: "model-modal-state" }, `Endpoint: ${preset.baseUrl}`)),

      h("div", { style: ROW },
        h("label", { style: LABEL, htmlFor: "rerank-key" }, "API key"),
        h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("input", {
            id: "rerank-key", type: "password", autoComplete: "off", spellCheck: false, style: { ...CONTROL, flex: 1 },
            value: draftKey, "data-testid": "rerank-key",
            placeholder: keyPresent ? "Already set — type a new key to replace it" : "Paste this provider's API key, then click outside this field",
            onChange: (event) => setDraftKey(event.target.value),
            // Committing on blur and on Enter is what keeps a partial key out of the vault.
            onBlur: () => { void commitKey(); },
            onKeyDown: (event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void commitKey();
            },
          }),
          keyPresent ? h("button", {
            type: "button", style: CONTROL, "data-testid": "rerank-key-clear",
            onClick: () => { setDraftKey(""); write({ [API_KEY_KEY]: null }, () => setStored({ ...stored, [API_KEY_KEY]: false })); },
          }, "Clear") : null),
        h("span", { className: "model-modal-state" },
          "Kept in the app's memory for as long as the app runs — this version never writes a key to disk, so it has to be pasted again after the app is reopened.")),

      h("div", { style: ROW },
        h("label", { style: LABEL, htmlFor: "rerank-model" }, "Model"),
        h("select", {
          id: "rerank-model", style: CONTROL, value: chosenModel, "data-testid": "rerank-model",
          onChange: (event) => write({ [MODEL_KEY]: event.target.value }, () => setStored({ ...stored, [MODEL_KEY]: event.target.value })),
        }, preset.models.map((model) => h("option", { key: model, value: model }, model)))));

  };
}
