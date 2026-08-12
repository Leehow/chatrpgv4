import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, PanelRightOpen, RefreshCw } from "lucide-react";
import * as api from "./api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CampaignSidebar } from "./components/CampaignSidebar";
import { Chat } from "./components/Chat";
import { ModelMenu } from "./components/ModelMenu";
import { NEW_INVESTIGATOR, NewCampaignFlow } from "./components/NewCampaignFlow";
import { Panel, PanelContent } from "./components/Panel";
import type {
  BootstrapResult,
  ChatMessage,
  GameState,
  ModelsResponse,
  SessionInfo,
} from "./types";

const LS = {
  provider: "coc-web.provider",
  model: "coc-web.model",
  campaign: "coc-web.campaign",
};

/** Kick the live Keeper into the canonical coc-character guided flow (same as CLI). */
const CHARACTER_SETUP_KICKOFF =
  "我选择新建调查员。请按规则集 skill「coc-character」做完整引导创建：" +
  "若战役有 character creation briefing，先读并展示其玩家向内容；" +
  "再请我选择属性生成方式（固定顺序掷骰 / 掷骰后分配 / 点数购买 460 / Quick Fire 数组）；" +
  "逐步完成概念、属性、年龄、职业、技能与背景；" +
  "我确认最终参数后，调用 investigator.create 创建正式调查员，" +
  "并用 campaign.link_investigator 挂到本战役（可替换建卡草稿壳）。全程使用简体中文。";

export default function App() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null);
  const [provider, setProvider] = useState(() => localStorage.getItem(LS.provider) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) ?? "");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTrail, setToolTrail] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  /** Session id waiting for automatic coc-character kickoff turn. */
  const kickoffRef = useRef<string | null>(null);
  /* Pure UI state (layout only — no effect on the session state machine). */
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.fetchModels().then(setModels).catch((e) => setError(String(e.message ?? e)));
    api
      .fetchBootstrap()
      .then((resp) => setBootstrap(resp.result))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

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
  }, [provider, model]);

  const openCampaign = useCallback(
    async (
      campaignId: string,
      opts?: { kickCharacterSetup?: boolean },
    ): Promise<SessionInfo | null> => {
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
        let emptyTranscript = true;
        try {
          const t = await api.fetchTranscript(info.session_id);
          emptyTranscript = t.messages.length === 0;
          setMessages(
            t.messages.map((m) =>
              m.role === "player"
                ? {
                    kind: "player" as const,
                    text: m.text,
                    at: m.at,
                  }
                : {
                    kind: "keeper" as const,
                    text: m.text,
                    at: m.at,
                    startedAt: m.started_at,
                    durationMs: m.duration_ms,
                  },
            ),
          );
        } catch {
          setMessages([]);
          emptyTranscript = true;
        }
        if (info.character_setup && emptyTranscript) {
          setMessages([
            {
              kind: "note",
              text:
                "角色创建：主界面由 KP 按 coc-character skill 引导（与 CLI 同一套），请按提示回答。",
              tone: "info",
              at: Date.now(),
            },
          ]);
        }
        setBusy(false);
        // After session is live, optionally kick the skill-guided creation turn.
        if (
          opts?.kickCharacterSetup &&
          info.character_setup &&
          emptyTranscript
        ) {
          return { ...info, character_setup: true };
        }
        return info;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
        return null;
      } finally {
        openingRef.current = null;
      }
    },
    [],
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
        | { mode: "starter"; scenarioId: string; pregenId: string; title: string }
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
                  pregen_id: args.pregenId,
                  ...(args.title ? { title: args.title } : {}),
                });
        const fresh = await api.fetchBootstrap();
        setBootstrap(fresh.result);
        const info = await openCampaign(resp.result.campaign_id, {
          kickCharacterSetup: wantsNew || Boolean(resp.result.needs_investigator),
        });
        if (info?.character_setup && (wantsNew || resp.result.needs_investigator)) {
          kickoffRef.current = info.session_id;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
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
      setMessages(
        t.messages.map((m) =>
          m.role === "player"
            ? {
                kind: "player" as const,
                text: m.text,
                at: m.at,
              }
            : {
                kind: "keeper" as const,
                text: m.text,
                at: m.at,
                startedAt: m.started_at,
                durationMs: m.duration_ms,
              },
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [session, busy]);

  // CLI 端跑完一回合后，切回浏览器标签即可同步视图。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const send = useCallback(
    async (text: string) => {
      const active = session;
      if (!active || busy || !text.trim()) return;
      setBusy(true);
      setError(null);
      setToolTrail([]);
      // Wall-clock from this user input until the whole turn settles (tools +
      // narration). Not SSE token drip duration.
      const inputAt = Date.now();
      setMessages((prev) => [
        ...prev,
        { kind: "player", text, at: inputAt, startedAt: inputAt },
        {
          kind: "keeper",
          text: "",
          streaming: true,
          startedAt: inputAt,
          at: inputAt,
        },
      ]);
      let settledText = "";
      await api.streamTurn(active.session_id, text, provider, model, {
        onTool: (phase, tool) => {
          const display = tool.replace(/^coc_invoke:/, "");
          if (phase === "start" && display) {
            setToolTrail((prev) =>
              prev.includes(display) ? prev : [...prev, display],
            );
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
        onTurn: ({ events, state: nextState }) => {
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
              next[i] = {
                ...row,
                text: narration || row.text || settledText,
                startedAt: row.startedAt ?? inputAt,
              };
              break;
            }
            return next;
          });
          if (nextState && !nextState.error) setState(nextState);
          setToolTrail([]);
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
          setError(message);
          setToolTrail([]);
        },
      });
      // Authoritative close: stream fully finished (turn event + end).
      const finishedAt = Date.now();
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const row = next[i];
          if (row.kind !== "keeper") continue;
          if (row.streaming || row.durationMs == null) {
            const start = row.startedAt ?? inputAt;
            next[i] = {
              kind: "keeper",
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
      setBusy(false);
    },
    [session, busy, provider, model],
  );

  // After「新建调查员」开局：自动发一条 kickoff，让 live KP 走 coc-character skill。
  useEffect(() => {
    const sid = kickoffRef.current;
    if (!sid || !session || session.session_id !== sid || busy) return;
    kickoffRef.current = null;
    void send(CHARACTER_SETUP_KICKOFF);
  }, [session, busy, send]);

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
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/70 px-3 backdrop-blur md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setNavOpen(true)}
          title="战役列表"
        >
          <Menu className="size-4" />
        </Button>
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg font-bold tracking-wide text-foreground">
            Cthulhu Keeper
          </span>
          <span className="hidden text-[10px] tracking-[0.25em] text-muted-foreground uppercase sm:inline">
            pi · SSE
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
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
          <ModelMenu
            models={models}
            provider={provider}
            model={model}
            disabled={busy}
            onChange={(p, m) => {
              setProvider(p);
              setModel(m);
            }}
          />
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
          className="cursor-pointer border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800"
          onClick={() => setError(null)}
        >
          {error}（点击关闭）
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ≥ md：固定战役侧栏 */}
        <aside className="hidden w-72 shrink-0 border-r border-border bg-card/40 md:block">
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
          {creating ? (
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
              toolTrail={toolTrail}
              busy={busy}
              connected={!!session}
              error={error}
              pendingChoice={state?.pending_choice}
              onSend={send}
            />
          )}

          {/* ≥ xl：常驻角色面板 */}
          <div className="hidden w-80 shrink-0 border-l border-border bg-card/40 xl:block">
            <Panel state={state} investigatorId={session?.investigator_id ?? null} />
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
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
