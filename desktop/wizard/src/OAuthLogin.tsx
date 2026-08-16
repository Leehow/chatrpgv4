import { useCallback, useEffect, useRef, useState } from "react";

// pi-style provider login, mirroring the pi TUI /login flow: pick a provider,
// then either sign in with the account (browser OAuth / device code) or paste
// an API key. All OAuth mechanics run in the main process via the bundled pi
// library; this component only renders its events and answers its prompts.

export type OAuthProvider = {
  id: string;
  label: string;
  note: string;
  methods: string[];
};

type AuthPromptShape = {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
};

type AuthEventShape =
  | { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number }
  | { type: "progress"; message: string };

type PromptState = { promptId: number; prompt: AuthPromptShape };

type LoginResult = { ok: boolean; provider?: string; credentialType?: string; models?: string[]; error?: string };

type Auth = {
  loginProvider: (providerId: string, method: string) => Promise<LoginResult>;
  respondPrompt: (promptId: number, value: string, cancel?: boolean) => Promise<{ ok: boolean }>;
  cancelLogin: () => Promise<{ ok: boolean }>;
  openUrl: (url: string) => Promise<{ ok: boolean }>;
  onAuthEvent: (cb: (payload: AuthEventShape) => void) => () => void;
  onAuthPrompt: (cb: (payload: PromptState) => void) => () => void;
  onAuthPromptDismissed: (cb: (payload: { promptId: number }) => void) => () => void;
};

const METHOD_LABELS: Record<string, string> = {
  oauth: "账户登录（打开浏览器）",
  api_key: "API Key 登录",
};

export default function OAuthLogin({
  provider,
  auth,
  onDone,
  onCancel,
}: {
  provider: OAuthProvider;
  auth: Auth;
  onDone: (result: LoginResult) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const leftRef = useRef(false);

  useEffect(() => {
    const offEvent = auth.onAuthEvent((event) => {
      if (event.type === "auth_url") {
        setStatus("已在浏览器打开授权页面，完成后会自动继续…");
      } else if (event.type === "device_code") {
        setDevice({ userCode: event.userCode, verificationUri: event.verificationUri });
        setStatus("已尝试打开验证页面，请在浏览器中输入以下代码完成登录…");
      } else if (event.type === "progress") {
        setStatus(event.message);
      } else if (event.type === "info") {
        setStatus(event.message);
      }
    });
    const offPrompt = auth.onAuthPrompt((payload) => {
      setPrompt(payload);
      setPromptInput("");
    });
    const offDismissed = auth.onAuthPromptDismissed(({ promptId }) => {
      setPrompt((current) => (current && current.promptId === promptId ? null : current));
    });
    return () => {
      offEvent();
      offPrompt();
      offDismissed();
    };
  }, [auth]);

  const start = useCallback(
    async (chosen: string) => {
      if (running.current) return;
      running.current = true;
      leftRef.current = false;
      setMethod(chosen);
      setError("");
      setStatus(chosen === "oauth" ? "正在启动登录…" : "");
      const result = await auth.loginProvider(provider.id, chosen);
      running.current = false;
      if (leftRef.current) return;
      if (result.ok) {
        onDone(result);
      } else {
        setStatus("");
        setDevice(null);
        setError(result.error || "登录失败");
      }
    },
    [auth, onDone, provider.id],
  );

  const cancel = useCallback(() => {
    leftRef.current = true;
    running.current = false;
    setMethod(null);
    setStatus("");
    setDevice(null);
    setPrompt(null);
    setPromptInput("");
    setError("");
    void auth.cancelLogin();
    onCancel();
  }, [auth, onCancel]);

  const submitPrompt = useCallback(
    async (value: string) => {
      if (!prompt) return;
      const { promptId } = prompt;
      setPrompt(null);
      await auth.respondPrompt(promptId, value);
    },
    [auth, prompt],
  );

  const answerSelect = useCallback(
    async (optionId: string) => {
      if (!prompt) return;
      const { promptId } = prompt;
      setPrompt(null);
      await auth.respondPrompt(promptId, optionId);
    },
    [auth, prompt],
  );

  const inFlight = method !== null && !error;

  return (
    <div className="form">
      <h2>{provider.label}</h2>
      <p className="hint">{provider.note}</p>

      {method === null && (
        <div className="preset-grid">
          {provider.methods.map((m) => (
            <button key={m} className="preset" onClick={() => void start(m)}>
              <strong>{METHOD_LABELS[m] || m}</strong>
            </button>
          ))}
        </div>
      )}

      {inFlight && (
        <>
          <p className="status" data-testid="auth-status">
            {status || "等待中…"}
          </p>
          {device && (
            <div className="device-code">
              <div className="code">{device.userCode}</div>
              <button className="ghost" onClick={() => void auth.openUrl(device.verificationUri)}>
                打开验证页面
              </button>
            </div>
          )}
          {prompt && (
            <div className="prompt-box">
              {prompt.prompt.type === "select" ? (
                <>
                  <p>{prompt.prompt.message}</p>
                  <div className="actions">
                    {(prompt.prompt.options || []).map((option) => (
                      <button key={option.id} onClick={() => void answerSelect(option.id)}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitPrompt(promptInput);
                  }}
                >
                  <label>
                    {prompt.prompt.message}
                    <input
                      type={prompt.prompt.type === "secret" ? "password" : "text"}
                      value={promptInput}
                      onChange={(e) => setPromptInput(e.target.value)}
                      placeholder={prompt.prompt.placeholder || ""}
                      autoFocus
                      autoComplete="off"
                    />
                  </label>
                  <p className="hint">
                    {prompt.prompt.type === "manual_code"
                      ? "也可以不粘贴，等浏览器授权完成后自动继续。"
                      : ""}
                  </p>
                  <div className="actions">
                    <button type="submit" disabled={!promptInput.trim()}>
                      提交
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          <div className="actions">
            <button className="ghost" onClick={cancel}>
              取消登录
            </button>
          </div>
        </>
      )}

      {error && (
        <>
          <ul className="errors">
            <li>{error}</li>
          </ul>
          <div className="actions">
            <button
              onClick={() => {
                setError("");
                setMethod(null);
                setStatus("");
                setDevice(null);
              }}
            >
              重试
            </button>
            <button className="ghost" onClick={onCancel}>
              返回
            </button>
          </div>
        </>
      )}
    </div>
  );
}
