import { Brain, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// 1:1 with the pi runner's --thinking enum. Actual support is per-model and
// resolved by Pi (e.g. grok has no true off; deepseek off = real disabled).
const LEVELS = [
  { id: "off", label: "关闭" },
  { id: "minimal", label: "最低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "超高" },
  { id: "max", label: "最高" },
] as const;

interface Props {
  thinking: string;
  /** Levels the active model supports, from /api/models; undefined keeps the
   *  generic list (metadata unknown). */
  levels?: string[];
  disabled?: boolean;
  /** composer = the compact pill embedded in the chat composer toolbar. */
  variant?: "topbar" | "composer";
  onChange: (level: string) => void;
}

/** Keeper thinking-intensity picker; the level rides the turn request and is
 *  applied when the runner session is created (a level switch starts a fresh
 *  warm worker, same as a model switch). */
export function ThinkingMenu({ thinking, levels, disabled, variant = "topbar", onChange }: Props) {
  const composer = variant === "composer";
  const options = LEVELS.filter((l) => !levels?.length || levels.includes(l.id));
  // Same clamp pi applies per request (up first, then down): a saved level
  // the active model doesn't support displays (and runs) as the nearest one.
  const thinkingIndex = LEVELS.findIndex((l) => l.id === thinking);
  const current =
    options.find((l) => l.id === thinking) ??
    options.find((l) => LEVELS.indexOf(l) >= thinkingIndex) ??
    options[options.length - 1];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={composer ? "ghost" : "outline"}
          size="sm"
          disabled={disabled}
          className={
            composer
              ? "h-7 gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
              : "h-9 gap-1.5 rounded-lg border-border/80 bg-card/70 px-2.5 shadow-none"
          }
          title="思考强度（thinking level）"
        >
          <Brain className={cn("shrink-0 text-primary", composer ? "size-3" : "size-3.5")} />
          <span className={cn("hidden truncate sm:inline", composer ? "text-[11px]" : "text-xs")}>
            思考 · {current.label}
          </span>
          <ChevronDown className={cn("hidden shrink-0 text-muted-foreground sm:block", composer ? "size-3" : "size-3.5")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={composer ? "top" : "bottom"}
        align={composer ? "start" : "end"}
        className="w-44"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">思考强度</DropdownMenuLabel>
        {options.map((l) => (
          <DropdownMenuItem
            key={l.id}
            onSelect={() => onChange(l.id)}
            className={cn("gap-2", l.id === current.id && "bg-accent")}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                l.id === current.id ? "bg-primary" : "bg-transparent",
              )}
            />
            <span className="truncate">{l.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
