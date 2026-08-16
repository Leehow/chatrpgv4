import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Appearance = "system" | "light" | "dark";

const META: Record<Appearance, { label: string; Icon: typeof Sun }> = {
  system: { label: "跟随系统", Icon: Monitor },
  light: { label: "浅色卷宗", Icon: Sun },
  dark: { label: "深色密仪", Icon: Moon },
};

export function AppearanceMenu({
  value,
  onChange,
}: {
  value: Appearance;
  onChange: (value: Appearance) => void;
}) {
  const { label, Icon } = META[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-lg border-border/80 bg-card/70 px-2.5 shadow-none"
          title={`外观：${label}`}
        >
          <Icon className="size-4 text-primary" />
          <span className="hidden text-xs lg:inline">外观</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          外观
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as Appearance)}
        >
          {(Object.entries(META) as [Appearance, (typeof META)[Appearance]][]).map(
            ([key, item]) => (
              <DropdownMenuRadioItem key={key} value={key}>
                <item.Icon className="size-4" />
                {item.label}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
