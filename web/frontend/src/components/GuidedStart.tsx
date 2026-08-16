import { useState } from "react";
import { ChevronLeft, Library, Package, ScrollText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NewCampaignFlow,
  type CreateArgs,
} from "./NewCampaignFlow";
import type { BootstrapResult, ModelsResponse } from "../types";

// First-run guided start: welcome + AI-readiness, then the module source
// choice, then the SAME campaign configuration flow as「＋ 新战役」.
// No second engine — everything downstream reuses NewCampaignFlow.

type Stage = "welcome" | "source" | "config";
type SourceMode = "starter" | "pdf" | "library";

interface Props {
  bootstrap: BootstrapResult | null;
  models: ModelsResponse | null;
  busy: boolean;
  onCreate: (args: CreateArgs) => void;
  onSkip: () => void;
  onBootstrapRefresh?: () => Promise<void>;
}

/** Desktop-shell affordance injected via preload; absent in plain browsers. */
type DesktopBridge = { openSettings?: () => void };

export function GuidedStart({
  bootstrap,
  models,
  busy,
  onCreate,
  onSkip,
  onBootstrapRefresh,
}: Props) {
  const [stage, setStage] = useState<Stage>("welcome");
  const [picked, setPicked] = useState<SourceMode | null>(null);

  const desktop = (window as { cocDesktop?: DesktopBridge }).cocDesktop;

  const defaultProvider = models?.providers[models.default.provider];
  const anyAuthed = Object.values(models?.providers ?? {}).some((p) => p.hasAuth);
  const aiReady = Boolean(defaultProvider?.hasAuth) || anyAuthed;
  const defaultModelLabel = defaultProvider
    ? `${defaultProvider.label} · ${
        defaultProvider.models.find((m) => m.id === models?.default.model)?.label ??
        models?.default.model
      }`
    : "—";

  const starters = bootstrap?.starters ?? [];
  const libraryModules = bootstrap?.library_modules ?? [];

  const sourceCards: Array<{
    id: SourceMode;
    label: string;
    desc: string;
    Icon: typeof ScrollText;
    available: boolean;
  }> = [
    {
      id: "starter",
      label: "内置模组",
      desc: "官方预置剧本，预设角色卡或自己创建调查员",
      Icon: ScrollText,
      available: starters.length > 0,
    },
    {
      id: "pdf",
      label: "上传 PDF 模组",
      desc: "用自己的跑团 PDF：本地解析后即可开局",
      Icon: Package,
      available: true,
    },
    ...(libraryModules.length
      ? [
          {
            id: "library" as const,
            label: "已解析剧本",
            desc: "从剧本库安装，跨战役复用",
            Icon: Library,
            available: true,
          },
        ]
      : []),
  ];

  if (stage === "config" && picked) {
    return (
      <NewCampaignFlow
        bootstrap={bootstrap}
        busy={busy}
        onCreate={onCreate}
        onBack={() => {
          setPicked(null);
          setStage("source");
        }}
        onBootstrapRefresh={onBootstrapRefresh}
        initialMode={picked}
      />
    );
  }

  if (stage === "source") {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <button
            type="button"
            onClick={() => setStage("welcome")}
            className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            返回
          </button>
          <p className="text-xs font-medium tracking-[0.25em] text-primary uppercase">
            Choose a Module
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold text-foreground">
            选一个剧本开始
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            用官方内置模组，或上传你自己的 PDF 跑团模组。
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {sourceCards.map(({ id, label, desc, Icon, available }) => (
              <button
                key={id}
                type="button"
                disabled={!available || busy}
                onClick={() => {
                  setPicked(id);
                  setStage("config");
                }}
                className={cn(
                  "group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left",
                  "transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                  !available && "pointer-events-none opacity-50",
                )}
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
          <Sparkles className="size-7" />
        </div>
        <h1 className="font-display mt-6 text-3xl font-semibold text-foreground">
          欢迎来到 COC Keeper
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          一位守秘人（KP）模型将为你主持克苏鲁的呼唤跑团。开始第一场战役之前，先确认
          AI 已就绪，然后选择一个剧本。
        </p>

        <div
          className={cn(
            "mt-8 rounded-2xl border px-5 py-4 shadow-xs",
            aiReady
              ? "border-success/40 bg-success-soft"
              : "border-warning/40 bg-warning-soft",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className={cn(
                  "text-sm font-semibold",
                  aiReady ? "text-success" : "text-warning",
                )}
              >
                {aiReady ? "AI 已就绪" : "尚未配置 AI 模型"}
              </p>
              <p
                className={cn(
                  "mt-1 text-xs leading-relaxed",
                  aiReady ? "text-success/80" : "text-warning/80",
                )}
              >
                {aiReady
                  ? `守秘人模型：${defaultModelLabel}，可在顶栏切换。`
                  : "需要先配置一个模型提供方（API Key 或订阅账户登录），才能开始跑团。"}
              </p>
            </div>
            {!aiReady && desktop?.openSettings && (
              <Button size="sm" onClick={() => desktop.openSettings?.()}>
                打开设置
              </Button>
            )}
          </div>
        </div>

        <div className="mt-10 flex items-center gap-3">
          <Button
            size="lg"
            disabled={!aiReady || busy}
            onClick={() => setStage("source")}
            className="min-w-40"
          >
            开始第一场战役
          </Button>
          <Button size="lg" variant="ghost" onClick={onSkip} disabled={busy}>
            先跳过，随便看看
          </Button>
        </div>
      </div>
    </div>
  );
}
