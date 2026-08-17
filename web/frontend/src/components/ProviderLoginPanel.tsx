import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "../api";
import type { ModelLoginSnapshot } from "../api";

type DesktopAuth = {
  loginProvider?: (providerId: string, method: string) => Promise<{ ok: boolean; error?: string }>;
  respondPrompt?: (promptId: number, value: string, cancel?: boolean) => Promise<{ ok: boolean }>;
  cancelLogin?: () => Promise<{ ok: boolean }>;
  openUrl?: (url: string) => Promise<{ ok: boolean }>;
  onAuthEvent?: (cb: (event: { type?: string; message?: string; url?: string; userCode?: string; verificationUri?: string }) => void) => () => void;
  onAuthPrompt?: (cb: (payload: { promptId: number; prompt: { type: string; message: string; placeholder?: string; options?: { id: string; label: string }[] } }) => void) => () => void;
  onAuthPromptDismissed?: (cb: (payload: { promptId: number }) => void) => () => void;
};

function desktopAuth(): DesktopAuth | undefined {
  return (window as { cocDesktop?: DesktopAuth }).cocDesktop;
}

export function ProviderLoginPanel({
  provider,
  method,
  onDone,
  onCancel,
}: {
  provider: { id: string; label: string; note: string };
  method: "oauth" | "api_key";
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState("正在启动登录…");
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [prompt, setPrompt] = useState<ModelLoginSnapshot["prompt"]>(null);
  const [promptInput, setPromptInput] = useState("");
  const [error, setError] = useState("");
  const opened = useRef(new Set<string>());
  const left = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const openUrl = (url: string) => {
    if (!url || opened.current.has(url)) return;
    opened.current.add(url);
    const desktop = desktopAuth();
    if (desktop?.openUrl) void desktop.openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    left.current = false;
    const desktop = desktopAuth();
    if (desktop?.loginProvider && desktop.onAuthEvent) {
      const offEvent = desktop.onAuthEvent((event) => {
        if (event.type === "device_code" && event.userCode && event.verificationUri) {
          setDevice({ userCode: event.userCode, verificationUri: event.verificationUri });
          setStatus("请在浏览器中输入以下代码完成登录…");
          openUrl(event.verificationUri);
        } else if (event.type === "auth_url" && event.url) {
          setStatus("已打开授权页面，完成后会自动继续…");
          openUrl(event.url);
        } else if (event.message) {
          setStatus(event.message);
        }
      });
      const offPrompt = desktop.onAuthPrompt?.((payload) => {
        setPrompt(payload);
        setPromptInput("");
      });
      const offDismissed = desktop.onAuthPromptDismissed?.(({ promptId }) => {
        setPrompt((current) => (current && current.promptId === promptId ? null : current));
      });
      void desktop.loginProvider(provider.id, method).then((result) => {
        if (left.current) return;
        if (result.ok) onDoneRef.current();
        else setError(result.error || "登录失败");
      });
      return () => {
        offEvent?.();
        offPrompt?.();
        offDismissed?.();
      };
    }

    let timer: number | undefined;
    void api
      .startModelLogin({ providerId: provider.id, method })
      .then((start) => {
        if (!start.ok) {
          setError(start.error || "无法开始登录");
          return;
        }
        const poll = async () => {
          if (left.current) return;
          const snap = await api.fetchModelLogin();
          for (const event of snap.events || []) {
            if (event.type === "device_code" && event.userCode && event.verificationUri) {
              setDevice({ userCode: event.userCode, verificationUri: event.verificationUri });
              setStatus("请在浏览器中输入以下代码完成登录…");
              openUrl(event.verificationUri);
            } else if ((event.type === "auth_url" || event.url) && event.url) {
              setStatus("已打开授权页面，完成后会自动继续…");
              openUrl(event.url);
            } else if (event.message) {
              setStatus(event.message);
            }
          }
          setPrompt(snap.prompt);
          if (snap.done) {
            if (snap.result?.ok) onDoneRef.current();
            else setError(snap.result?.error || "登录失败");
            return;
          }
          timer = window.setTimeout(() => void poll(), 400);
        };
        void poll();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [method, provider.id]);

  const cancel = () => {
    left.current = true;
    const desktop = desktopAuth();
    if (desktop?.cancelLogin) void desktop.cancelLogin();
    else void api.cancelModelLogin().catch(() => undefined);
    onCancel();
  };

  const submitPrompt = async (value: string) => {
    if (!prompt) return;
    const promptId = prompt.promptId;
    setPrompt(null);
    const desktop = desktopAuth();
    if (desktop?.respondPrompt) await desktop.respondPrompt(promptId, value);
    else await api.respondModelLogin({ promptId, value });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xl">
        <h3 className="font-display text-lg font-semibold">{provider.label}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{provider.note}</p>
        {!error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {status}
          </div>
        )}
        {device && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-center">
            <div className="font-mono text-2xl tracking-[0.3em]">{device.userCode}</div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => openUrl(device.verificationUri)}>
              打开验证页面
            </Button>
          </div>
        )}
        {prompt && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPrompt(promptInput);
            }}
          >
            <p className="text-sm">{prompt.prompt.message}</p>
            {prompt.prompt.type === "select" ? (
              <div className="flex flex-col gap-1.5">
                {(prompt.prompt.options || []).map((option) => (
                  <Button key={option.id} type="button" variant="outline" onClick={() => void submitPrompt(option.id)}>
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : (
              <>
                <Input
                  type={prompt.prompt.type === "secret" ? "password" : "text"}
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder={prompt.prompt.placeholder || ""}
                  autoFocus
                  autoComplete="off"
                />
                <Button type="submit" disabled={!promptInput.trim()}>
                  提交
                </Button>
              </>
            )}
          </form>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancel}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
