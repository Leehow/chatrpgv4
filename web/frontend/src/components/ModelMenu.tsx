import { ChevronDown, Cpu, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { modelRouteIdentity } from "../model-thinking";
import type { ModelsResponse } from "../types";

/** Desktop-shell affordance injected via preload; absent in plain browsers. */
type DesktopBridge = { openSettings?: (opts?: { edit?: boolean }) => void };

interface Props {
  models: ModelsResponse | null;
  provider: string;
  model: string;
  disabled?: boolean;
  /** Provider ids unchecked in the settings 编辑模型 editor (desktop only). */
  hidden?: string[];
  /** composer = the compact pill embedded in the chat composer toolbar. */
  variant?: "topbar" | "composer";
  onChange: (provider: string, model: string) => void;
}

/** Single-dropdown model picker (provider + model merged); keeps persistence
 *  and onChange semantics of the former dual-select ModelPicker. */
export function ModelMenu({ models, provider, model, disabled, hidden, variant = "topbar", onChange }: Props) {
  const composer = variant === "composer";
  if (!models) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className={cn(
          "gap-1.5 text-muted-foreground",
          composer ? "h-7 rounded-full px-2 text-[11px]" : "h-9",
        )}
      >
        <Loader2 className="size-3.5 animate-spin" />
        模型…
      </Button>
    );
  }
  const providers = Object.entries(models.providers).filter(
    ([pid]) => !hidden?.includes(pid),
  );
  const activeProvider = models.providers[provider];
  const activeModel = activeProvider?.models.find((m) => m.id === model);
  const activeRoute = activeProvider
    ? modelRouteIdentity({
        provider,
        model,
        providerLabel: activeProvider.label,
        modelLabel: activeModel?.label || model || "模型",
      })
    : null;
  const desktop = (window as { cocDesktop?: DesktopBridge }).cocDesktop;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={composer ? "ghost" : "outline"}
          size="sm"
          disabled={disabled}
          className={
            composer
              ? "h-7 max-w-48 gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
              : "h-9 max-w-48 gap-1.5 rounded-lg border-border/80 bg-card/70 px-2.5 shadow-none sm:max-w-56"
          }
          title={activeRoute
            ? `Keeper 模型（pi runner）：${activeRoute.label}`
            : "Keeper 模型（pi runner）"}
          aria-label={activeRoute ? `Keeper 模型：${activeRoute.label}` : "Keeper 模型"}
        >
          <Cpu className={cn("shrink-0 text-primary", composer ? "size-3" : "size-3.5")} />
          <span className={cn("flex min-w-0 items-center gap-1", composer ? "text-[11px]" : "text-xs")}>
            <span className="shrink-0 font-medium">
              {activeRoute?.providerLabel ?? "模型"}
            </span>
            {activeRoute && (
              <>
                <span className="shrink-0 text-muted-foreground/70">·</span>
                <span className="truncate">{activeRoute.modelLabel}</span>
              </>
            )}
          </span>
          <ChevronDown className={cn("hidden shrink-0 text-muted-foreground sm:block", composer ? "size-3" : "size-3.5")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={composer ? "top" : "bottom"}
        align={composer ? "start" : "end"}
        className="max-h-96 w-72 overflow-y-auto"
      >
        {providers.map(([pid, info], i) => (
          <DropdownMenuGroup key={pid}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-muted-foreground">
              {info.label}
              {info.hasAuth ? "" : "（未配置凭据）"}
            </DropdownMenuLabel>
            {info.models.map((m) => {
              const route = modelRouteIdentity({
                provider: pid,
                model: m.id,
                providerLabel: info.label,
                modelLabel: m.label,
              });
              const selected = route.provider === provider && route.model === model;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => onChange(route.provider, route.model)}
                  className={cn("gap-2", selected && "bg-accent")}
                  aria-label={route.label}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      selected ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{route.modelLabel}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {route.providerLabel}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
        {desktop?.openSettings && (
          <>
            {providers.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => desktop.openSettings?.({ edit: true })}
              className="gap-2 text-muted-foreground"
            >
              <Plus className="size-3.5 shrink-0" />
              <span className="truncate">加入模型…</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
