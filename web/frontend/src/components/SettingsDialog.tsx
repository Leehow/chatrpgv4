import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelsResponse } from "../types";
import { EditModelsDialog } from "./EditModelsDialog";
import {
  SettingsGeneralPane,
  type PortraitImageSelection,
  type VisionSelection,
} from "./SettingsGeneralPane";

type SettingsTab = "general" | "models";

export function SettingsDialog({
  open,
  onClose,
  onChanged,
  models,
  hiddenProviders,
  vision,
  onVisionChange,
  keeperProvider,
  portraitImage,
  onPortraitImageChange,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: (hidden: string[]) => void;
  models: ModelsResponse | null;
  hiddenProviders: string[];
  vision: VisionSelection;
  onVisionChange: (next: VisionSelection) => void;
  keeperProvider?: string;
  portraitImage: PortraitImageSelection;
  onPortraitImageChange: (next: PortraitImageSelection) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("models");

  useEffect(() => {
    if (open) setTab("models");
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="flex max-h-[min(40rem,100%)] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">设置</h2>
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} title="关闭">
            <X className="size-4" />
          </Button>
        </div>
        <div role="tablist" aria-label="设置分类" className="flex gap-1 border-b border-border">
          {(
            [
              ["general", "通用"],
              ["models", "模型"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn(
                "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
                tab === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "general" ? (
            <SettingsGeneralPane
              models={models}
              hiddenProviders={hiddenProviders}
              vision={vision}
              onVisionChange={onVisionChange}
              keeperProvider={keeperProvider}
              portraitImage={portraitImage}
              onPortraitImageChange={onPortraitImageChange}
            />
          ) : null}
          <div className={tab === "models" ? "block" : "hidden"}>
            <EditModelsDialog embedded open={open} onClose={onClose} onChanged={onChanged} />
          </div>
        </div>
      </div>
    </div>
  );
}
