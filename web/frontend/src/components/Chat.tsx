import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { toolToStatus, trailToCurrentStatus } from "../toolStatus";
import type { ChatMessage, PendingChoice } from "../types";

interface Props {
  messages: ChatMessage[];
  toolTrail: string[];
  busy: boolean;
  connected: boolean;
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
      {!done && <span className="cursor cursor--status">▍</span>}
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
    <span className="msg__meta">
      <span>{formatClock(now)}</span>
      <span className="msg__meta-sep">·</span>
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
      className="msg__meta"
      title={
        msg.kind === "keeper"
          ? "完成时刻 · 从你发送输入到本回合全部内容出完的总墙钟时间"
          : "你发送这条输入的时刻"
      }
    >
      {at != null && <span className="msg__meta-time">{formatClock(at)}</span>}
      {durationMs != null && msg.kind === "keeper" && (
        <>
          {at != null && <span className="msg__meta-sep">·</span>}
          <span className="msg__meta-duration">
            回合用时 {formatDuration(durationMs)}
          </span>
        </>
      )}
    </div>
  );
}

export function Chat({
  messages,
  toolTrail,
  busy,
  connected,
  pendingChoice,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const statusLine = trailToCurrentStatus(toolTrail);
  // Past steps as short Chinese chips (skip the latest — it's the typewriter line).
  // Keep full trail order; only collapse consecutive identical status lines.
  const pastStatuses: string[] = [];
  for (const t of toolTrail.slice(0, -1)) {
    const label = toolToStatus(t);
    if (pastStatuses[pastStatuses.length - 1] !== label) {
      pastStatuses.push(label);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, toolTrail, statusLine]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || !connected) return;
    setDraft("");
    onSend(text);
  };

  const choices = pendingChoice?.options ?? [];

  return (
    <section className="chat">
      <div className="chat__scroll">
        {!connected && (
          <div className="chat__welcome">
            <h1>克苏鲁的呼唤</h1>
            <p>从左侧选择一场战役，或创建新战役开始游戏。</p>
            <p className="chat__hint">
              Keeper 由 pi 驱动；叙述将通过 SSE 逐字流出。
            </p>
          </div>
        )}
        {connected && messages.length === 0 && !busy && (
          <div className="chat__welcome">
            <p>这场战役还没有公开的对话记录。</p>
            <p className="chat__hint">
              在下方输入你的第一个行动，例如「我走向那栋房子，打量周围」。
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.kind === "player") {
            return (
              <div key={i} className="msg msg--player">
                <div className="msg__bubble">{msg.text}</div>
                <MessageMeta msg={msg} />
              </div>
            );
          }
          if (msg.kind === "note") {
            return (
              <div
                key={i}
                className={
                  "msg msg--note" + (msg.tone === "error" ? " msg--error" : "")
                }
              >
                {msg.text}
                <MessageMeta msg={msg} />
              </div>
            );
          }
          const isLast = i === messages.length - 1;
          const showStatus = Boolean(isLast && msg.streaming && !msg.text);
          return (
            <div key={i} className="msg msg--keeper">
              <div className="msg__role">Keeper</div>
              {showStatus && pastStatuses.length > 0 && (
                <div className="tool-trail" aria-hidden>
                  {pastStatuses.map((label, j) => (
                    <span key={j} className="tool-badge tool-badge--zh">
                      {label.replace(/…$/, "")}
                    </span>
                  ))}
                </div>
              )}
              <div className="msg__card">
                {msg.text ? (
                  <Markdown text={msg.text} />
                ) : (
                  <TypewriterLine
                    text={showStatus ? statusLine : "KP 正在主持这场遭遇…"}
                    className="msg__thinking"
                    cps={20}
                  />
                )}
                {msg.streaming && msg.text ? (
                  <span className="cursor">▍</span>
                ) : null}
              </div>
              <MessageMeta msg={msg} />
            </div>
          );
        })}

        {connected && !busy && choices.length > 0 && (
          <div className="choices">
            {pendingChoice?.prompt && (
              <div className="choices__prompt">{pendingChoice.prompt}</div>
            )}
            {choices.map((opt, i) => (
              <button
                key={i}
                className="btn btn--choice"
                onClick={() => onSend(opt.label || opt.action)}
              >
                {opt.label || opt.action}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat__composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            connected ? "描述你的行动…（Enter 发送，Shift+Enter 换行）" : "先选择一场战役"
          }
          disabled={!connected || busy}
          rows={2}
        />
        <button
          className="btn btn--primary chat__send"
          onClick={submit}
          disabled={!connected || busy || !draft.trim()}
        >
          {busy ? "主持中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
