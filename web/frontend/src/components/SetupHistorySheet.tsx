import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchSetupTranscript } from "../api";
import {
  setupHistoryDescription,
  setupHistoryTitle,
} from "../setup-history";
import type { SetupTranscriptPayload, TranscriptMessage } from "../types";
import { Markdown } from "./Markdown";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function SetupHistoryRow({ message }: { message: TranscriptMessage }) {
  const isPlayer = message.role === "player";
  return (
    <div className={isPlayer ? "flex flex-col items-end gap-1" : "flex flex-col items-start gap-1"}>
      <div className="text-[11px] text-muted-foreground">{isPlayer ? "你" : "KP"}</div>
      {isPlayer ? (
        <div className="max-w-[85%] rounded-xl border border-border bg-player-note px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground shadow-[0_1px_2px_rgb(var(--paper-ink)/0.06),0_6px_16px_rgb(var(--paper-ink)/0.04)]">
          {message.text}
        </div>
      ) : (
        <div className="keeper-message max-w-[95%] text-[15px] leading-7 text-foreground">
          {message.text ? <Markdown text={message.text} /> : null}
        </div>
      )}
    </div>
  );
}

export function SetupHistorySheet({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SetupTranscriptPayload | null>(null);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setError(null);
      setPayload(null);
      return;
    }
    if (!sessionId) {
      setStatus("error");
      setError("当前没有活动会话。");
      setPayload(null);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    setPayload(null);
    void fetchSetupTranscript(sessionId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setPayload(next);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === "AbortError" || /aborted/i.test(message)) return;
        setError(message || "无法读取建卡记录。");
        setStatus("error");
      });
    return () => controller.abort();
  }, [open, sessionId]);

  const title = setupHistoryTitle(payload?.scope);
  const description = setupHistoryDescription(payload?.scope);
  const messages = payload?.messages ?? [];

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-lg"
        aria-label={title}
      >
        <SheetHeader className="border-b border-border px-4 py-3 pr-12">
          <SheetTitle className="font-display text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {status === "loading" || status === "idle" ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取建卡记录…
            </div>
          ) : null}
          {status === "error" ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive">
              {error || "无法读取建卡记录。"}
            </div>
          ) : null}
          {status === "ready" && messages.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              没有找到建卡阶段的对话记录。
            </p>
          ) : null}
          {status === "ready" && messages.length > 0 ? (
            <div className="flex flex-col gap-4">
              {messages.map((message, index) => (
                <SetupHistoryRow
                  key={`${message.role}:${message.at ?? index}:${index}`}
                  message={message}
                />
              ))}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
