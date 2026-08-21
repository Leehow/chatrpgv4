export const SIDEBAR_RAIL_WIDTH = 44;

export const SIDEBAR_LEFT_BOUNDS = { defaultWidth: 256, minWidth: 192, maxWidth: 480 } as const;
export const SIDEBAR_RIGHT_BOUNDS = { defaultWidth: 320, minWidth: 256, maxWidth: 560 } as const;

export function clampWidth(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

export function readStoredWidth(
  storage: Storage,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clampWidth(parsed, min, max);
  } catch {
    return fallback;
  }
}

export function readStoredCollapsed(storage: Storage, key: string, fallback: boolean): boolean {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

export function writeStoredWidth(storage: Storage, key: string, value: number): void {
  try {
    storage.setItem(key, String(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function writeStoredCollapsed(storage: Storage, key: string, value: boolean): void {
  try {
    storage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function dragToWidth(
  side: "left" | "right",
  startWidth: number,
  deltaPx: number,
  min: number,
  max: number,
): number {
  const next = side === "left" ? startWidth + deltaPx : startWidth - deltaPx;
  return clampWidth(next, min, max);
}

export function renderedSidebarWidth(collapsed: boolean, width: number): number {
  return collapsed ? SIDEBAR_RAIL_WIDTH : width;
}

/** Remote preferred wins over LS, then default. Missing remote is not 0. */
export function resolveHydratedWidth(input: {
  remote: number | null | undefined;
  storedRaw: string | null;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (typeof input.remote === "number" && Number.isFinite(input.remote)) {
    return clampWidth(input.remote, input.min, input.max);
  }
  if (input.storedRaw == null) return input.fallback;
  const parsed = Number(input.storedRaw);
  if (!Number.isFinite(parsed)) return input.fallback;
  return clampWidth(parsed, input.min, input.max);
}

export function resolveHydratedCollapsed(input: {
  remote: boolean | null | undefined;
  storedRaw: string | null;
  fallback: boolean;
}): boolean {
  if (typeof input.remote === "boolean") return input.remote;
  if (input.storedRaw == null) return input.fallback;
  return input.storedRaw === "1";
}

/** Upload LS once when remote has no layout object. Never before remote loaded. */
export function shouldUploadLayoutFallback(input: {
  remoteLoaded: boolean;
  remoteHasLayout: boolean;
  hasLocalLayout: boolean;
  alreadyUploaded: boolean;
}): boolean {
  return input.remoteLoaded && !input.remoteHasLayout && input.hasLocalLayout && !input.alreadyUploaded;
}

export function hasLocalLayoutKeys(storage: Storage, widthKey: string, collapsedKey: string): boolean {
  try {
    return storage.getItem(widthKey) != null || storage.getItem(collapsedKey) != null;
  } catch {
    return false;
  }
}

export function responsiveSidebarClasses(hasChatContent: boolean): {
  leftColumn: string;
  rightColumn: string;
  leftSheetTrigger: string;
  rightSheetTrigger: string;
} {
  if (hasChatContent) {
    return {
      leftColumn: "hidden xl:block",
      rightColumn: "hidden md:block",
      leftSheetTrigger: "xl:hidden",
      rightSheetTrigger: "md:hidden",
    };
  }
  return {
    leftColumn: "hidden md:block",
    rightColumn: "hidden xl:block",
    leftSheetTrigger: "md:hidden",
    rightSheetTrigger: "xl:hidden",
  };
}
