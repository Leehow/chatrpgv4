import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Menu, PanelRightOpen, Pencil, RefreshCw } from "lucide-react";
import * as api from "./api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CampaignSidebar } from "./components/CampaignSidebar";
import { AppearanceMenu, type Appearance } from "./components/AppearanceMenu";
import { Chat, type QuickStartAction } from "./components/Chat";
import { GuidedStart } from "./components/GuidedStart";
import { ModelMenu } from "./components/ModelMenu";
import { ThinkingMenu } from "./components/ThinkingMenu";
import { NEW_INVESTIGATOR, NewCampaignFlow } from "./components/NewCampaignFlow";
import { Panel, PanelContent } from "./components/Panel";
import type {
  BootstrapResult,
  ChatMessage,
  GameState,
  ModelsResponse,
  PlayerIntent,
  SessionInfo,
  TranscriptMessage,
} from "./types";

const LS = {
  provider: "coc-web.provider",
  model: "coc-web.model",
  thinking: "coc-web.thinking",
  campaign: "coc-web.campaign",
  guidedDismissed: "coc-web.guided-dismissed",
  appearance: "coc-web.appearance",
};

function savedAppearance(): Appearance {
  const saved = localStorage.getItem(LS.appearance);
  return saved === "system" || saved === "dark" || saved === "light" ? saved : "light";
}

/** Structured submissions from the (retired) character-creator wizard. */
const SUBMISSION_PREFIX = "【建卡构想提交】";

function playerMessage(text: string, at: number = Date.now()): ChatMessage {
  if (text.startsWith(SUBMISSION_PREFIX)) {
    const identity = text.split("\n")[1] || "";
    return {
      kind: "note",
      text: `已提交调查员构想（${identity.slice(0, 40)}），守秘人正在落卡。`,
      tone: "info",
      at,
    };
  }
  return { kind: "player", text, at };
}

function transcriptMessages(messages: TranscriptMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.role === "player"
      ? playerMessage(message.text, message.at)
      : {
          kind: "keeper" as const,
          text: message.text,
          contentBlocks: message.content_blocks,
          at: message.at,
          startedAt: message.started_at,
          durationMs: message.duration_ms,
        },
  );
}

/** pi-coc conversation lives on the host session; campaign table-transcript
 *  is often empty or a lagging jsonl prefix. Empty/shorter same-campaign
 *  projections must not wipe a fuller in-memory thread. Switching campaigns
 *  always shows that campaign's own history (empty means empty). */
function replaceMessagesFromTranscript(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  messages: TranscriptMessage[] | undefined,
  sameCampaign: boolean,
) {
  const next = transcriptMessages(Array.isArray(messages) ? messages : []);
  if (!sameCampaign) {
    setMessages(next);
    return next.length > 0;
  }
  if (next.length === 0) return false;
  let applied = false;
  setMessages((prev) => {
    if (next.length < prev.length) return prev;
    applied = true;
    return next;
  });
  return applied;
}

/** A tool call starting means everything streamed so far this turn is
 *  workflow narration, not the reply. Fold it into interimText so the
 *  visible body only ever holds the segment after the last tool call. */
function foldInterimSegment(prev: ChatMessage[]): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.kind !== "keeper" || !last.streaming || !last.text) {
    return prev;
  }
  const next = [...prev];
  next[next.length - 1] = {
    ...last,
    interimText: [last.interimText, last.text.trim()]
      .filter(Boolean)
      .join("\n"),
    text: "",
  };
  return next;
}

/** Raw Python/Node tracebacks must never land on the player's screen as-is. */
function friendlyError(message: string): string {
  if (
    /\bFileNotFoundError\b|\bTraceback\b/.test(message) ||
    /\n\s*File "/.test(message)
  ) {
    return "后台服务出现异常（可能正在更新或文件被占用）。请退出并重新打开应用；若持续出现请查看日志目录。";
  }
  return message;
}

export default function App() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null);
  const [provider, setProvider] = useState(() => localStorage.getItem(LS.provider) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) ?? "");
  const [thinking, setThinking] = useState(() => localStorage.getItem(LS.thinking) ?? "off");
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Live keeper-turn step feed (one entry per tool start, closed on end). */
  const [toolSteps, setToolSteps] = useState<
    { id: number; label: string; startedAt: number; endedAt?: number }[]
  >([]);
  const toolStepSeq = useRef(0);
  /** Aborts the in-flight turn's SSE stream; the turn still settles server-side. */
  const turnAbortRef = useRef<AbortController | null>(null);
  /** Live keeper-side thinking text (observer feed; spoiler-bearing). */
  const [kpThinking, setKpThinking] = useState("");
  /** Live cumulative token usage for the running turn. */
  const [liveUsage, setLiveUsage] = useState<{ input: number | null; output: number | null } | null>(null);
  /** Ref mirror: the turn handler reads the cumulative counter, which the
   *  telemetry record underreports (it covers only the final model call). */
  const liveUsageRef = useRef<{ input: number | null; output: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const lastRefreshAtRef = useRef(0);
  /* Pure UI state (layout only — no effect on the session state machine). */
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** First-run guided start; auto-entered for a workspace without campaigns. */
  const [guided, setGuided] = useState(false);
  const guidedChecked = useRef(false);
  /** Desktop fatal notice (bridge died): styled in-app modal, not a native box. */
  const [fatal, setFatal] = useState<{ title: string; message: string; detail?: string } | null>(null);
  const [fatalBusy, setFatalBusy] = useState(false);
  const isDesktop = Boolean((window as { cocDesktop?: unknown }).cocDesktop);
  const desktopShell = (
    window as {
      cocDesktop?: { openSettings?: (opts?: { edit?: boolean }) => void };
    }
  ).cocDesktop;

  // 编辑模型 curation: providers unchecked in the settings editor disappear
  // from the model dropdown too. Desktop-only; plain browsers show all.
  const [hiddenProviders, setHiddenProviders] = useState<string[]>([]);
  useEffect(() => {
    const desktop = (
      window as {
        cocDesktop?: {
          getHiddenProviders?: () => Promise<{ hidden: string[] }>;
          onHiddenProviders?: (cb: (p: { hidden: string[] }) => void) => () => void;
        };
      }
    ).cocDesktop;
    if (!desktop?.getHiddenProviders) return;
    void desktop.getHiddenProviders().then((r) => setHiddenProviders(r.hidden || []));
    return desktop.onHiddenProviders?.((p) => setHiddenProviders(p.hidden || []));
  }, []);

  useEffect(() => {
    const desktop = (
      window as {
        cocDesktop?: {
          onFatal?: (
            cb: (info: { title: string; message: string; detail?: string }) => void,
          ) => () => void;
        };
      }
    ).cocDesktop;
    if (!desktop?.onFatal) return;
    return desktop.onFatal((info) => setFatal(info));
  }, []);

  useEffect(() => {
    api.fetchModels().then(setModels).catch((e) => setError(friendlyError(String(e.message ?? e))));
    api
      .fetchBootstrap()
      .then((resp) => setBootstrap(resp.result))
      .catch((e) => setError(friendlyError(String(e.message ?? e))));
  }, []);

  // Desktop pushes app:modelsChanged after a provider login / save writes
  // models.json; without this the dropdown keeps the mount-time snapshot
  // (e.g. an empty list) until the app is restarted.
  useEffect(() => {
    const desktop = (
      window as {
        cocDesktop?: { onModelsChanged?: (cb: () => void) => () => void };
      }
    ).cocDesktop;
    if (!desktop?.onModelsChanged) return;
    return desktop.onModelsChanged(() => {
      api.fetchModels().then(setModels).catch(() => {});
    });
  }, []);

  // A fresh workspace (no campaigns) opens the guided start once; any real
  // campaign present means the player already knows the way in.
  useEffect(() => {
    if (!bootstrap || guidedChecked.current) return;
    guidedChecked.current = true;
    const hasCampaigns = bootstrap.campaigns.some((c) => c.compatible !== false);
    if (!hasCampaigns && !localStorage.getItem(LS.guidedDismissed)) {
      setGuided(true);
    }
  }, [bootstrap]);

  // Reconcile persisted / default model selection once the model list lands.
  useEffect(() => {
    if (!models) return;
    const providerOk = provider && models.providers[provider];
    const nextProvider = providerOk ? provider : models.default.provider;
    const modelList = models.providers[nextProvider]?.models ?? [];
    const modelOk = modelList.some((m) => m.id === model);
    // Fallback must honor the bridge-declared default (e.g. gpt-5.6-luna),
    // not the catalog's first entry: keeper turns are contract-driven and
    // silently degrade to the weaker first-listed model otherwise.
    const fallbackModel =
      nextProvider === models.default.provider
        ? models.default.model
        : models.providers[nextProvider]?.models[0]?.id ?? "";
    const nextModel = modelOk ? model : fallbackModel;
    if (nextProvider !== provider || nextModel !== model) {
      setProvider(nextProvider);
      setModel(nextModel);
    }
  }, [models]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (provider) localStorage.setItem(LS.provider, provider);
    if (model) localStorage.setItem(LS.model, model);
    if (thinking) localStorage.setItem(LS.thinking, thinking);
  }, [provider, model, thinking]);

  useEffect(() => {
    localStorage.setItem(LS.appearance, appearance);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    if (appearance !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  const openCampaign = useCallback(
    async (campaignId: string): Promise<SessionInfo | null> => {
      // In-flight guard only: released in `finally` so the same campaign can be
      // reopened later (e.g. to pick up turns played in the CLI).
      if (openingRef.current === campaignId) return null;
      openingRef.current = campaignId;
      setBusy(true);
      setError(null);
      try {
        const info = await api.createSession(campaignId);
        setSession(info);
        setState(info.state);
        localStorage.setItem(LS.campaign, campaignId);
        const sameCampaign = session?.campaign_id === campaignId;
        try {
          const t = await api.fetchTranscript(info.session_id);
          replaceMessagesFromTranscript(setMessages, t.messages, sameCampaign);
        } catch {
          replaceMessagesFromTranscript(setMessages, [], sameCampaign);
        }
        if (!info.host_opening) {
          setBusy(false);
          return info;
        }
        const inputAt = Date.now();
        setMessages((prev) => [
          ...prev,
          {
            kind: "note",
            text: "正在打开 pi-coc 桌面……",
            tone: "info",
            at: inputAt,
          },
          {
            kind: "keeper",
            text: "",
            streaming: true,
            startedAt: inputAt,
            at: inputAt,
          },
        ]);
        const controller = new AbortController();
        turnAbortRef.current = controller;
        let settledText = "";
        await api.streamTurn(
          info.session_id,
          "",
          provider,
          model,
          thinking,
          undefined,
          {
            onTool: (phase, tool) => {
              if (phase === "start") {
                setMessages(foldInterimSegment);
                settledText = "";
              }
              const display = tool.replace(/^coc_invoke:/, "");
              if (!display || display.startsWith("coc_discover")) return;
              if (phase === "start") {
                const id = ++toolStepSeq.current;
                setToolSteps((prev) => [...prev, { id, label: display, startedAt: Date.now() }]);
              } else if (phase === "end") {
                setToolSteps((prev) => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].label === display && next[i].endedAt == null) {
                      next[i] = { ...next[i], endedAt: Date.now() };
                      break;
                    }
                  }
                  return next;
                });
              }
            },
            onDelta: (delta) => {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.kind === "keeper" && last.streaming) {
                  next[next.length - 1] = {
                    ...last,
                    text: last.text + delta,
                    startedAt: last.startedAt ?? inputAt,
                  };
                  settledText = last.text + delta;
                }
                return next;
              });
            },
            onThinking: (chunk) => {
              setKpThinking((prev) => (prev + chunk).slice(-8000));
            },
            onUsage: (usage) => {
              const value = { input: usage.input, output: usage.output };
              liveUsageRef.current = value;
              setLiveUsage(value);
            },
            onTurn: ({ state: nextState }) => {
              if (nextState && !nextState.error) setState(nextState);
              setToolSteps([]);
              setLiveUsage(null);
              liveUsageRef.current = null;
            },
            onError: (message) => {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.kind === "keeper" && last.streaming && !last.text) {
                  next.pop();
                }
                return next;
              });
              setError(friendlyError(message));
            },
          },
          controller.signal,
          { attach: true },
        );
        turnAbortRef.current = null;
        const finishedAt = Date.now();
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const row = next[i];
            if (row.kind !== "keeper") continue;
            if (!row.text && !settledText) {
              next.splice(i, 1);
              break;
            }
            next[i] = {
              ...row,
              text: row.text || settledText,
              streaming: false,
              at: finishedAt,
              startedAt: row.startedAt ?? inputAt,
              durationMs: finishedAt - (row.startedAt ?? inputAt),
            };
            break;
          }
          return next;
        });
        // An attached host-opening stream carries plain text while it is live.
        // Once settled, replace it with the canonical typed transcript so SAN,
        // combat, and other public receipts render as structured UI cards.
        try {
          const transcript = await api.fetchTranscript(info.session_id);
          replaceMessagesFromTranscript(setMessages, transcript.messages, true);
        } catch {
          // Keep the settled stream visible; top-bar refresh retries projection.
        }
        setBusy(false);
        return info;
      } catch (e) {
        setError(friendlyError(e instanceof Error ? e.message : String(e)));
        setBusy(false);
        return null;
      } finally {
        openingRef.current = null;
      }
    },
    [model, provider, session, thinking],
  );

  // Reopen the last campaign once the campaign list is available.
  useEffect(() => {
    if (!bootstrap || session) return;
    const last = localStorage.getItem(LS.campaign);
    if (last && bootstrap.campaigns.some((c) => c.campaign_id === last)) {
      void openCampaign(last);
    }
  }, [bootstrap, session, openCampaign]);

  const createCampaign = useCallback(
    async (
      args:
        | {
            mode: "starter";
            scenarioId: string;
            pregenId: string | null;
            title: string;
          }
        | {
            mode: "pdf";
            sourceBundlePath: string;
            investigatorId: string;
            title: string;
            era: string;
          }
        | {
            mode: "library";
            moduleId: string;
            investigatorId: string;
            title: string;
          },
    ) => {
      setBusy(true);
      setError(null);
      try {
        const wantsNew =
          (args.mode === "pdf" || args.mode === "library") &&
          args.investigatorId === NEW_INVESTIGATOR;
        const invId =
          args.mode === "starter" || wantsNew
            ? undefined
            : args.mode === "pdf" || args.mode === "library"
              ? args.investigatorId
              : undefined;

        const resp =
          args.mode === "pdf"
            ? await api.createCampaign({
                mode: "pdf",
                source_bundle_path: args.sourceBundlePath,
                ...(invId ? { investigator_id: invId } : {}),
                ...(args.title ? { title: args.title } : {}),
                ...(args.era ? { era: args.era } : {}),
              })
            : args.mode === "library"
              ? await api.createCampaign({
                  mode: "library",
                  canonical_module_id: args.moduleId,
                  ...(invId ? { investigator_id: invId } : {}),
                  ...(args.title ? { title: args.title } : {}),
                })
              : await api.createCampaign({
                  mode: "starter",
                  scenario_id: args.scenarioId,
                  ...(args.pregenId ? { pregen_id: args.pregenId } : {}),
                  ...(args.title ? { title: args.title } : {}),
                });
        const fresh = await api.fetchBootstrap();
        setBootstrap(fresh.result);
        setGuided(false);
        await openCampaign(resp.result.campaign_id);
      } catch (e) {
        setError(friendlyError(e instanceof Error ? e.message : String(e)));
        setBusy(false);
      }
    },
    [openCampaign],
  );

  // Pull the latest canonical state + transcript. Used for cross-host play:
  // turns played in the CLI land in the same campaign logs, so a refresh
  // shows them here (and vice versa). Self-heals the in-memory session id.
  const refresh = useCallback(async () => {
    const active = session;
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      let sid = active.session_id;
      let nextState: GameState;
      try {
        nextState = await api.fetchState(sid);
      } catch {
        const reopened = await api.createSession(active.campaign_id);
        setSession(reopened);
        sid = reopened.session_id;
        nextState = reopened.state;
      }
      setState(nextState);
      const t = await api.fetchTranscript(sid);
      replaceMessagesFromTranscript(setMessages, t.messages, true);
      lastRefreshAtRef.current = Date.now();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [session, busy]);

  // Sidebar consumable use: one canonical state.item_use through the bridge,
  // then the response's fresh state replaces the panel (used-up items vanish).
  const handleUseItem = useCallback(
    async (itemId: string) => {
      const active = session;
      if (!active) return;
      try {
        const next = await api.useItem(active.session_id, itemId);
        setState(next);
      } catch (e) {
        setError(friendlyError(e instanceof Error ? e.message : String(e)));
      }
    },
    [session],
  );

  // CLI 端跑完一回合后，切回浏览器标签即可同步视图。
  // Settings is a parented sheet: closing it can fire a brief visibility
  // bounce; skip a second refresh within 1s of the last successful one.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAtRef.current < 1000) return;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const send = useCallback(
    async (text: string, playerIntent?: PlayerIntent) => {
      const active = session;
      if (!active || busy || !text.trim()) return;
      setBusy(true);
      setError(null);
      setToolSteps([]);
      setKpThinking("");
      setLiveUsage(null);
      liveUsageRef.current = null;
      // Wall-clock from this user input until the whole turn settles (tools +
      // narration). Not SSE token drip duration.
      const inputAt = Date.now();
      setMessages((prev) => [
        ...prev,
        playerMessage(text, inputAt),
        {
          kind: "keeper",
          text: "",
          streaming: true,
          startedAt: inputAt,
          at: inputAt,
        },
      ]);
      let settledText = "";
      const controller = new AbortController();
      turnAbortRef.current = controller;
      await api.streamTurn(active.session_id, text, provider, model, thinking, playerIntent, {
        onTool: (phase, tool) => {
          if (phase === "start") {
            setMessages(foldInterimSegment);
            settledText = "";
          }
          const display = tool.replace(/^coc_invoke:/, "");
          if (!display) return;
          // Catalog probes are internal deliberation noise, not table steps.
          if (display.startsWith("coc_discover")) return;
          if (phase === "start") {
            const id = ++toolStepSeq.current;
            setToolSteps((prev) => [...prev, { id, label: display, startedAt: Date.now() }]);
          } else if (phase === "end") {
            setToolSteps((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].label === display && next[i].endedAt == null) {
                  next[i] = { ...next[i], endedAt: Date.now() };
                  break;
                }
              }
              return next;
            });
          }
        },
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.kind === "keeper" && last.streaming) {
              // Never reset startedAt — elapsed is input→all-content, not drip.
              next[next.length - 1] = {
                ...last,
                text: last.text + delta,
                startedAt: last.startedAt ?? inputAt,
              };
              settledText = last.text + delta;
            }
            return next;
          });
        },
        onDeltaReset: () => {
          settledText = "";
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.kind === "keeper" && last.streaming) {
              next[next.length - 1] = {
                ...last,
                text: "",
                startedAt: last.startedAt ?? inputAt,
              };
            }
            return next;
          });
        },
        onThinking: (chunk) => {
          setKpThinking((prev) => (prev + chunk).slice(-8000));
        },
        onUsage: (usage) => {
          const value = { input: usage.input, output: usage.output };
          liveUsageRef.current = value;
          setLiveUsage(value);
        },
        onTurn: ({ events, state: nextState, usage }) => {
          const narration = events
            .filter(
              (e) =>
                (e.type === "narration" || e.type === "speech") &&
                e.visibility === "player",
            )
            .map((e) => String(e.payload?.text ?? ""))
            .filter((t) => t.trim())
            .join("\n\n");
          if (narration) settledText = narration;
          // Update text now; duration is closed only after the SSE stream ends
          // so we measure input → all content delivered, not mid-stream.
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const row = next[i];
              if (row.kind !== "keeper") continue;
              const live = liveUsageRef.current;
              const settledUsage =
                live && (live.input != null || live.output != null)
                  ? { input: live.input ?? undefined, output: live.output ?? undefined }
                  : usage &&
                      (typeof usage.input_tokens === "number" ||
                        typeof usage.output_tokens === "number")
                    ? {
                        input: usage.input_tokens ?? undefined,
                        output: usage.output_tokens ?? undefined,
                      }
                    : undefined;
              next[i] = {
                ...row,
                text: narration || row.text || settledText,
                startedAt: row.startedAt ?? inputAt,
                ...(settledUsage ? { usage: settledUsage } : {}),
              };
              break;
            }
            return next;
          });
          if (nextState && !nextState.error) setState(nextState);
          setToolSteps([]);
          setLiveUsage(null);
          liveUsageRef.current = null;
        },
        onError: (message) => {
          const finishedAt = Date.now();
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.kind === "keeper" && last.streaming && !last.text) {
              next.pop();
            } else if (last && last.kind === "keeper") {
              const start = last.startedAt ?? inputAt;
              next[next.length - 1] = {
                ...last,
                streaming: false,
                at: finishedAt,
                startedAt: start,
                durationMs: finishedAt - start,
              };
            }
            return next;
          });
          setError(friendlyError(message));
          setToolSteps([]);
          setLiveUsage(null);
          liveUsageRef.current = null;
        },
      },
      controller.signal);
      const stopped = controller.signal.aborted;
      turnAbortRef.current = null;
      // Authoritative close: stream fully finished (turn event + end).
      const finishedAt = Date.now();
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const row = next[i];
          if (row.kind !== "keeper") continue;
          if (row.streaming || row.durationMs == null) {
            const start = row.startedAt ?? inputAt;
            // Spread row first so turn-event extras (usage tokens) survive
            // the authoritative close.
            next[i] = {
              ...row,
              text: settledText || row.text,
              streaming: false,
              at: finishedAt,
              startedAt: start,
              durationMs: finishedAt - start,
            };
          }
          break;
        }
        return next;
      });
      if (stopped) {
        // Stopped mid-turn: keep the partial text on screen. The background
        // turn has NOT settled yet, so a transcript re-read now would wipe
        // the partial reply with the pre-turn transcript — skip it.
        setMessages((prev) => [
          ...prev,
          {
            kind: "note",
            text: "已停止接收本回合输出。后台仍在结算这一回合，稍后点顶部刷新即可同步结果。",
            tone: "info",
            at: Date.now(),
          },
        ]);
        setBusy(false);
        return;
      }
      // Re-read the settled canonical transcript so typed finalization
      // segments (including public dice receipts) replace the streaming text.
      try {
        const transcript = await api.fetchTranscript(active.session_id);
        replaceMessagesFromTranscript(setMessages, transcript.messages, true);
      } catch {
        // The streamed narration remains usable when transcript refresh is
        // temporarily unavailable; the top-bar refresh can retry later.
      }
      setBusy(false);
    },
    [session, busy, provider, model, thinking],
  );

  /** Stop the in-flight keeper turn's live stream. */
  const stop = useCallback(() => {
    turnAbortRef.current?.abort();
  }, []);

  // --- Campaign admin (rename / trash / restore) — semantics live in the
  // bridge + runtime; these wrappers refresh projections and reset the local
  // session when the active campaign itself goes to the trash.

  const renameCampaign = useCallback(async (campaignId: string, title: string) => {
    try {
      await api.renameCampaign(campaignId, title);
      const fresh = await api.fetchBootstrap();
      setBootstrap(fresh.result);
      return true;
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
      return false;
    }
  }, []);

  const trashCampaign = useCallback(
    async (campaignId: string) => {
      try {
        await api.trashCampaign(campaignId);
        if (session?.campaign_id === campaignId) {
          // Deleting the open campaign: drop the local view; the server
          // closed the underlying session before moving the directory.
          turnAbortRef.current?.abort();
          setSession(null);
          setState(null);
          setMessages([]);
          localStorage.removeItem(LS.campaign);
        }
        const fresh = await api.fetchBootstrap();
        setBootstrap(fresh.result);
        return true;
      } catch (e) {
        setError(friendlyError(e instanceof Error ? e.message : String(e)));
        return false;
      }
    },
    [session],
  );

  const listTrash = useCallback(async () => {
    const resp = await api.fetchTrash();
    return resp.entries;
  }, []);

  const restoreFromTrash = useCallback(async (trashKey: string) => {
    try {
      await api.restoreCampaign(trashKey);
      const fresh = await api.fetchBootstrap();
      setBootstrap(fresh.result);
      return true;
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
      return false;
    }
  }, []);

  // Character creation still pending: the linked investigator is the setup
  // draft shell — its placeholder numbers are not a real character sheet.
  const setupPending = state?.character_setup_pending === true;

  // 候场一键开局：预置剧本 + 自建调查员（开局后 KP 引导建卡），直接进游戏。
  const quickStartStarter = bootstrap?.starters?.[0] ?? null;
  const quickStart: QuickStartAction | null = quickStartStarter
    ? {
        hint: `${quickStartStarter.title}${
          quickStartStarter.era ? `（${quickStartStarter.era}）` : ""
        } · 开局后由 KP 引导创建调查员`,
        run: () => {
          void createCampaign({
            mode: "starter",
            scenarioId: quickStartStarter.scenario_id,
            pregenId: null,
            title: "",
          });
        },
      }
    : null;

  // Same readiness semantics as GuidedStart: the default provider or any
  // authed provider counts (the model menu can switch between them). Null
  // while the provider list is still loading.
  const aiReady = models
    ? Boolean(models.providers[models.default.provider]?.hasAuth) ||
      Object.values(models.providers).some((p) => p.hasAuth)
    : null;

  const sidebarContent = (close: () => void) => (
    <CampaignSidebar
      bootstrap={bootstrap}
      activeCampaign={session?.campaign_id ?? null}
      busy={busy}
      onOpen={(id) => {
        close();
        setCreating(false);
        void openCampaign(id);
      }}
      onNew={() => {
        close();
        setCreating(true);
      }}
      onRename={renameCampaign}
      onTrash={trashCampaign}
      onListTrash={listTrash}
      onRestore={restoreFromTrash}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      {fatal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-destructive/40 bg-destructive-soft text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  {fatal.message}
                </h2>
                {fatal.detail && (
                  <p className="mt-1.5 text-xs leading-relaxed break-words text-muted-foreground">
                    {fatal.detail}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                disabled={fatalBusy}
                onClick={() => {
                  const desktop = (window as { cocDesktop?: { quitApp?: () => Promise<unknown> } }).cocDesktop;
                  if (desktop?.quitApp) void desktop.quitApp();
                }}
              >
                退出应用
              </Button>
              <Button
                disabled={fatalBusy}
                onClick={() => {
                  const desktop = (
                    window as { cocDesktop?: { restartBridge?: () => Promise<{ ok: boolean }> } }
                  ).cocDesktop;
                  if (!desktop?.restartBridge) return;
                  setFatalBusy(true);
                  // Success path reloads this window with the new bridge port.
                  desktop.restartBridge().then((r) => {
                    if (!r?.ok) setFatalBusy(false);
                  }).catch(() => setFatalBusy(false));
                }}
              >
                {fatalBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    正在重启后台…
                  </>
                ) : (
                  "重启后台服务"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/70 px-3 backdrop-blur md:px-4",
          isDesktop && "app-drag pl-20 md:pl-20",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn("md:hidden", isDesktop && "app-no-drag")}
          onClick={() => setNavOpen(true)}
          title="战役列表"
        >
          <Menu className="size-4" />
        </Button>
        {/* Phones: the header is a control bar — brand drops out below sm so
            model / thinking / appearance / panel all stay reachable. */}
        <div className="flex items-center gap-2.5">
          <span className="brand-seal hidden sm:inline-block" aria-hidden="true" />
          <span className="hidden font-display text-[1.35rem] font-bold tracking-[0.08em] text-foreground sm:inline">
            <span className="text-primary">AI</span> KEEPER
          </span>
          <span className="hidden text-[10px] tracking-[0.25em] text-muted-foreground uppercase sm:inline">
            pi-coc
          </span>
        </div>
        <div className={cn("ml-auto flex items-center gap-1.5", isDesktop && "app-no-drag")}>
          {session && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refresh()}
              disabled={busy}
              title="从战役存档刷新对话与状态（CLI 端玩过的回合会同步过来）"
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
            </Button>
          )}
          {desktopShell?.openSettings && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => desktopShell.openSettings?.({ edit: true })}
              title="编辑模型（提供方与显示列表）"
            >
              <Pencil className="size-4" />
            </Button>
          )}
          <ModelMenu
            models={models}
            provider={provider}
            model={model}
            disabled={busy}
            hidden={hiddenProviders}
            onChange={(p, m) => {
              setProvider(p);
              setModel(m);
            }}
          />
          <ThinkingMenu
            thinking={thinking}
            levels={
              models?.providers[provider]?.models.find((m) => m.id === model)?.thinkingLevels
            }
            disabled={busy}
            onChange={setThinking}
          />
          <AppearanceMenu value={appearance} onChange={setAppearance} />
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setPanelOpen(true)}
            title="角色面板"
          >
            <PanelRightOpen className="size-4" />
          </Button>
        </div>
      </header>

      {error && (
        <div
          className="cursor-pointer border-b border-warning/40 bg-warning-soft px-4 py-2 text-center text-xs text-warning select-none transition-colors"
          onClick={() => setError(null)}
        >
          {error}（点击关闭）
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ≥ md：固定战役侧栏 */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar md:block">
          {sidebarContent(() => undefined)}
        </aside>

        {/* < md：左侧抽屉 */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetTitle className="sr-only">战役卷宗</SheetTitle>
            {sidebarContent(() => setNavOpen(false))}
          </SheetContent>
        </Sheet>

        <main className="flex min-h-0 min-w-0 flex-1">
          {guided ? (
            <GuidedStart
              bootstrap={bootstrap}
              models={models}
              busy={busy}
              onCreate={(args) => void createCampaign(args)}
              onSkip={() => {
                localStorage.setItem(LS.guidedDismissed, "1");
                setGuided(false);
              }}
              onBootstrapRefresh={async () => {
                const fresh = await api.fetchBootstrap();
                setBootstrap(fresh.result);
              }}
            />
          ) : creating ? (
            <NewCampaignFlow
              bootstrap={bootstrap}
              busy={busy}
              onCreate={(args) => {
                setCreating(false);
                void createCampaign(args);
              }}
              onBack={() => setCreating(false)}
              onBootstrapRefresh={async () => {
                const fresh = await api.fetchBootstrap();
                setBootstrap(fresh.result);
              }}
            />
          ) : (
            <Chat
              messages={messages}
              toolSteps={toolSteps}
              kpThinking={kpThinking}
              liveUsage={liveUsage}
              busy={busy}
              connected={!!session}
              error={error}
              pendingChoice={state?.pending_choice}
              sceneLabel={state?.active_scene_label || state?.active_scene_id || null}
              combat={state?.combat ?? null}
              quickStart={quickStart}
              modelsReady={aiReady}
              onConfigureModels={
                desktopShell?.openSettings
                  ? () => desktopShell.openSettings?.({ edit: true })
                  : undefined
              }
              onSend={send}
              onStop={stop}
            />
          )}

          {/* ≥ xl：常驻角色面板 */}
          <div className="hidden w-80 shrink-0 border-l border-border bg-sidebar xl:block">
            <Panel
              state={state}
              investigatorId={session?.investigator_id ?? null}
              setupPending={setupPending}
              onUseItem={handleUseItem}
            />
          </div>
        </main>

        {/* < xl：角色面板右侧抽屉 */}
        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          <SheetContent side="right" className="w-80 overflow-y-auto px-4 py-5">
            <SheetTitle className="font-display text-lg font-semibold">
              角色卷宗
            </SheetTitle>
            <div className="mt-3">
              <PanelContent
                state={state}
                investigatorId={session?.investigator_id ?? null}
                setupPending={setupPending}
                onUseItem={handleUseItem}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
