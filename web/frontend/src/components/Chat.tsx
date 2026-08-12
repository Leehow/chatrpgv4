import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { toolToStatus, trailToCurrentStatus } from "../toolStatus";
import type { ChatMessage, PendingChoice } from "../types";

interface Props {
  messages: ChatMessage[];
  toolTrail: string[];
  busy: boolean;
  connected: boolean;
  /** Last bridge/session error; surfaced prominently when disconnected. */
  error?: string | null;
  pendingChoice?: PendingChoice | null;
  onSend: (text: string) => void;
}

/** Type out `text` character-by-character; restarts when `text` changes. */
function TypewriterLine({
  text,
  cps = 22,
  className,
}: {
  text: string;
  /** Characters per second. */
  cps?: number;
  className?: string;
}) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown("");
    setDone(false);
    if (!text) return;
    let i = 0;
    const intervalMs = Math.max(16, Math.round(1000 / cps));
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        setDone(true);
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [text, cps]);

  return (
    <span className={className}>
      {shown}
      {!done && <span className="cursor-blink text-primary">▍</span>}
    </span>
  );
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} 毫秒`;
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const s = totalSec >= 10 ? totalSec.toFixed(1) : totalSec.toFixed(2);
    return `${s.replace(/\.?0+$/, "")} 秒`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.round(totalSec - minutes * 60);
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
}

/** Live-updating elapsed line while a keeper reply is still streaming. */
function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>{formatClock(now)}</span>
      <span>·</span>
      <span>已等待 {formatDuration(now - startedAt)}</span>
    </span>
  );
}

function MessageMeta({ msg }: { msg: ChatMessage }) {
  if (msg.kind === "keeper" && msg.streaming && msg.startedAt != null) {
    return <LiveElapsed startedAt={msg.startedAt} />;
  }
  const at = msg.at ?? msg.startedAt;
  const durationMs = msg.durationMs;
  if (at == null && durationMs == null) return null;
  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title={
        msg.kind === "keeper"
          ? "完成时刻 · 从你发送输入到本回合全部内容出完的总墙钟时间"
          : "你发送这条输入的时刻"
      }
    >
      {at != null && <span>{formatClock(at)}</span>}
      {durationMs != null && msg.kind === "keeper" && (
        <>
          {at != null && <span>·</span>}
          <span>回合用时 {formatDuration(durationMs)}</span>
        </>
      )}
    </div>
  );
}

interface RowProps {
  msg: ChatMessage;
  /** Only ever true for the last keeper message. */
  showStatus: boolean;
  pastStatuses: string[];
  statusLine: string;
}

/** Stable identity handed to every row that shows no live status, so the memo
 *  below is not defeated by a fresh `[]` on each render. */
const NO_STATUSES: string[] = [];

/** One message row. Memoized: past rows keep stable object identity and get
 *  constant status props, so only the actively-mutating last row re-renders
 *  during a stream. */
const MessageRow = memo(function MessageRow({
  msg,
  showStatus,
  pastStatuses,
  statusLine,
}: RowProps) {
  if (msg.kind === "player") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground shadow-sm">
          {msg.text}
        </div>
        <MessageMeta msg={msg} />
      </div>
    );
  }
  if (msg.kind === "note") {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <div
          className={cn(
            "max-w-[90%] rounded-full border px-4 py-1.5 text-center text-xs",
            msg.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          {msg.text}
        </div>
        <MessageMeta msg={msg} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="font-display pl-1 text-xs font-semibold tracking-[0.18em] text-primary/80 uppercase">
        Keeper
      </div>
      {showStatus && pastStatuses.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-hidden>
          {pastStatuses.map((label, j) => (
            <Badge
              key={j}
              variant="secondary"
              className="rounded-full bg-secondary/80 font-normal text-muted-foreground"
            >
              {label.replace(/…$/, "")}
            </Badge>
          ))}
        </div>
      )}
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
        {msg.text ? (
          msg.streaming ? (
            /* Streaming: render plain text + cursor; Markdown mounts only
               once the turn settles (no per-token markdown re-parse). */
            <span className="whitespace-pre-wrap">
              {msg.text}
              <span className="cursor-blink text-primary">▍</span>
            </span>
          ) : (
            <Markdown text={msg.text} />
          )
        ) : (
          <TypewriterLine
            text={showStatus ? statusLine : "KP 正在主持这场遭遇…"}
            className="text-muted-foreground"
            cps={20}
          />
        )}
      </div>
      <MessageMeta msg={msg} />
    </div>
  );
});

export function Chat({
  messages,
  toolTrail,
  busy,
  connected,
  error,
  pendingChoice,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Auto-scroll only while the reader is near the bottom. */
  const nearBottomRef = useRef(true);
  const statusLine = trailToCurrentStatus(toolTrail);
  // Past steps as short Chinese chips (skip the latest — it's the typewriter line).
  // Keep full trail order; only collapse consecutive identical status lines.
  // Memoized on the trail: a new array every render would bust MessageRow's
  // memo for every row on each streamed delta.
  const pastStatuses = useMemo(() => {
    const out: string[] = [];
    for (const t of toolTrail.slice(0, -1)) {
      const label = toolToStatus(t);
      if (out[out.length - 1] !== label) out.push(label);
    }
    return out;
  }, [toolTrail]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottomRef.current) return;
    const lastMsg = messages[messages.length - 1];
    const streaming =
      busy || (lastMsg?.kind === "keeper" && lastMsg.streaming === true);
    // Instant while streaming (smooth fights the token drip); smooth otherwise.
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [messages, toolTrail, statusLine, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || !connected) return;
    setDraft("");
    nearBottomRef.current = true;
    onSend(text);
  };

  const choices = pendingChoice?.options ?? [];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-8">
          {!connected && (
            <div className="flex flex-col items-center gap-3 px-4 pt-20 text-center">
              {error ? (
                <>
                  <h1 className="font-display text-2xl font-semibold text-foreground">
                    无法进入该战役
                  </h1>
                  <div className="max-w-xl whitespace-pre-wrap break-words rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800">
                    {error}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    请换一场战役，或从左侧「＋ 新战役」重新开局。
                  </p>
                </>
              ) : (
                <>
                  <h1 className="font-display text-3xl font-semibold text-foreground">
                    克苏鲁的呼唤
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    从左侧选择一场战役，或创建新战役开始游戏。
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Keeper 由 pi 驱动；叙述将通过 SSE 逐字流出。
                  </p>
                </>
              )}
            </div>
          )}
          {connected && messages.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-2 px-4 pt-20 text-center">
              <p className="text-sm text-muted-foreground">
                这场战役还没有公开的对话记录。
              </p>
              <p className="text-xs text-muted-foreground/70">
                在下方输入你的第一个行动，例如「我走向那栋房子，打量周围」。
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            const showStatus = Boolean(
              isLast && msg.kind === "keeper" && msg.streaming && !msg.text,
            );
            // Stable composite key: kind + timing fields + position tiebreaker
            // (messages only ever append, so position is stable per message).
            const key = `${msg.kind}:${msg.at ?? "x"}:${msg.startedAt ?? "x"}:${i}`;
            return (
              <MessageRow
                key={key}
                msg={msg}
                showStatus={showStatus}
                /* Constant props for settled rows — only the live row may
                   carry churning status values. */
                pastStatuses={showStatus ? pastStatuses : NO_STATUSES}
                statusLine={showStatus ? statusLine : ""}
              />
            );
          })}

          {connected && !busy && choices.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
              {pendingChoice?.prompt && (
                <div className="text-xs font-medium text-muted-foreground">
                  {pendingChoice.prompt}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {choices.map((opt, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant="outline"
                    className="h-auto rounded-full whitespace-normal py-1.5 text-xs"
                    onClick={() => onSend(opt.label || opt.action)}
                  >
                    {opt.label || opt.action}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3 md:px-8">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              connected
                ? "描述你的行动…（Enter 发送，Shift+Enter 换行）"
                : "先选择一场战役"
            }
            disabled={!connected || busy}
            rows={2}
            className="min-h-14 resize-none rounded-xl bg-card"
          />
          <Button
            size="icon"
            className="size-11 shrink-0 rounded-xl"
            onClick={submit}
            disabled={!connected || busy || !draft.trim()}
            title={busy ? "主持中…" : "发送"}
          >
            {busy ? (
              <span className="text-xs">…</span>
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
