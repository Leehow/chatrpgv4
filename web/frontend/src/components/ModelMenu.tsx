import { ChevronDown, Cpu, Loader2 } from "lucide-react";
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
import type { ModelsResponse } from "../types";

interface Props {
  models: ModelsResponse | null;
  provider: string;
  model: string;
  disabled?: boolean;
  onChange: (provider: string, model: string) => void;
}

/** Single-dropdown model picker (provider + model merged); keeps persistence
 *  and onChange semantics of the former dual-select ModelPicker. */
export function ModelMenu({ models, provider, model, disabled, onChange }: Props) {
  if (!models) {
    return (
      <Button variant="ghost" size="sm" disabled className="gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        模型…
      </Button>
    );
  }
  const providers = Object.entries(models.providers);
  const activeProvider = models.providers[provider];
  const activeModel = activeProvider?.models.find((m) => m.id === model);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="max-w-56 gap-1.5"
          title="Keeper 模型（pi runner）"
        >
          <Cpu className="size-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs">
            {activeProvider ? activeProvider.label : "模型"}
            {activeModel ? ` · ${activeModel.label}` : ""}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        {providers.map(([pid, info], i) => (
          <DropdownMenuGroup key={pid}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-muted-foreground">
              {info.label}
              {info.hasAuth ? "" : "（未配置凭据）"}
            </DropdownMenuLabel>
            {info.models.map((m) => {
              const selected = pid === provider && m.id === model;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => onChange(pid, m.id)}
                  className={cn("gap-2", selected && "bg-accent")}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      selected ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span className="truncate">{m.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
