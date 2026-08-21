import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_RAIL_WIDTH,
  clampWidth,
  dragToWidth,
  readStoredCollapsed,
  readStoredWidth,
  renderedSidebarWidth,
  writeStoredCollapsed,
  writeStoredWidth,
} from "../sidebar-layout";

export type SidebarSide = "left" | "right";

export type GutterHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

type UseResizableOptions = {
  side: SidebarSide;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  preferredWidth?: number;
  onWidthCommit?: (width: number) => void;
};

export function useResizableSidebarWidth({
  side,
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  preferredWidth,
  onWidthCommit,
}: UseResizableOptions) {
  const widthKey = storageKey.endsWith(".width") ? storageKey : `${storageKey}.width`;
  const [width, setWidth] = useState(() =>
    readStoredWidth(window.localStorage, widthKey, defaultWidth, minWidth, maxWidth),
  );
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  const skipHydrateCommit = useRef(true);
  const onWidthCommitRef = useRef(onWidthCommit);
  onWidthCommitRef.current = onWidthCommit;

  useEffect(() => {
    if (typeof preferredWidth !== "number" || !Number.isFinite(preferredWidth)) return;
    const next = clampWidth(preferredWidth, minWidth, maxWidth);
    skipHydrateCommit.current = true;
    setWidth(next);
  }, [preferredWidth, minWidth, maxWidth]);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      skipHydrateCommit.current = false;
      writeStoredWidth(window.localStorage, widthKey, widthRef.current);
      onWidthCommitRef.current?.(widthRef.current);
      drag.current = null;
      setDragging(false);
    },
    [widthKey],
  );

  const gutterHandlers: GutterHandlers = {
    onPointerDown: (event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      setDragging(true);
    },
    onPointerMove: (event) => {
      if (!drag.current) return;
      const delta = event.clientX - drag.current.startX;
      setWidth(dragToWidth(side, drag.current.startWidth, delta, minWidth, maxWidth));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return { width, setWidth, dragging, gutterHandlers };
}

export function ResizeGutter({
  side,
  className,
  gutterHandlers,
  dragging,
}: {
  side: SidebarSide;
  className?: string;
  gutterHandlers: GutterHandlers;
  dragging: boolean;
}) {
  return (
    <div
      data-resizing={dragging ? "true" : undefined}
      className={cn(
        "absolute inset-y-0 z-10 w-2.5 cursor-col-resize touch-none hover:bg-primary/15",
        dragging && "bg-primary/20",
        side === "left" ? "right-0" : "left-0",
        className,
      )}
      {...gutterHandlers}
    />
  );
}

export function SidebarLayout({
  side,
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  className,
  preferredWidth,
  preferredCollapsed,
  onWidthChange,
  onWidthCommit,
  onCollapsedChange,
  children,
}: {
  side: SidebarSide;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  className?: string;
  preferredWidth?: number;
  preferredCollapsed?: boolean;
  onWidthChange?: (renderedWidthPx: number) => void;
  onWidthCommit?: (width: number) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const { width, dragging, gutterHandlers } = useResizableSidebarWidth({
    side,
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    preferredWidth,
    onWidthCommit,
  });
  const [collapsed, setCollapsed] = useState(() =>
    readStoredCollapsed(window.localStorage, `${storageKey}.collapsed`, false),
  );
  const hydrateCollapsed = useRef(true);
  const onCollapsedChangeRef = useRef(onCollapsedChange);
  onCollapsedChangeRef.current = onCollapsedChange;

  useEffect(() => {
    if (typeof preferredCollapsed !== "boolean") return;
    hydrateCollapsed.current = true;
    setCollapsed(preferredCollapsed);
  }, [preferredCollapsed]);

  const rendered = renderedSidebarWidth(collapsed, width);

  useEffect(() => {
    onWidthChange?.(rendered);
  }, [rendered, onWidthChange]);

  return (
    <div className={cn("relative h-full min-w-0 shrink-0", className)} style={{ width: rendered }}>
      {collapsed ? (
        <div className="flex h-full w-full flex-col items-center justify-center">
          <button
            type="button"
            title="展开侧栏"
            aria-label="展开侧栏"
            className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
            onClick={() => {
              hydrateCollapsed.current = false;
              writeStoredCollapsed(window.localStorage, `${storageKey}.collapsed`, false);
              setCollapsed(false);
              onCollapsedChangeRef.current?.(false);
            }}
          >
            {side === "left" ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>
      ) : (
        <>
          <div className="h-full min-w-0 w-full overflow-hidden">{children}</div>
          <button
            type="button"
            title="收起侧栏"
            aria-label="收起侧栏"
            className={cn(
              "absolute top-2 z-20 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground",
              side === "left" ? "-right-3" : "-left-3",
            )}
            onClick={() => {
              hydrateCollapsed.current = false;
              writeStoredCollapsed(window.localStorage, `${storageKey}.collapsed`, true);
              setCollapsed(true);
              onCollapsedChangeRef.current?.(true);
            }}
          >
            {side === "left" ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <ResizeGutter side={side} gutterHandlers={gutterHandlers} dragging={dragging} />
        </>
      )}
    </div>
  );
}
