import type { ModelsResponse } from "../types";

interface Props {
  models: ModelsResponse | null;
  provider: string;
  model: string;
  disabled?: boolean;
  onChange: (provider: string, model: string) => void;
}

export function ModelPicker({ models, provider, model, disabled, onChange }: Props) {
  if (!models) {
    return <div className="model-picker model-picker--loading">模型…</div>;
  }
  const providers = Object.entries(models.providers);
  const active = models.providers[provider];
  const modelOptions = active ? active.models : [];
  return (
    <div className="model-picker" title="Keeper 模型（pi runner）">
      <span className="model-picker__label">模型</span>
      <select
        value={provider}
        disabled={disabled}
        onChange={(e) => {
          const nextProvider = e.target.value;
          const first = models.providers[nextProvider]?.models[0]?.id ?? "";
          onChange(nextProvider, first);
        }}
      >
        {providers.map(([id, info]) => (
          <option key={id} value={id}>
            {info.label}
            {info.hasAuth ? "" : "（未配置凭据）"}
          </option>
        ))}
      </select>
      <select
        value={model}
        disabled={disabled || !modelOptions.length}
        onChange={(e) => onChange(provider, e.target.value)}
      >
        {modelOptions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
