import { APP_DISPLAY_NAME } from "./app-icon.mjs";

/**
 * Pure BrowserWindow options for the wizard / settings UI.
 * Sheet path (settings after main exists): parented dialog dismissed by the
 * main window's next click (main.mjs) — never a native modal sheet, which
 * swallows every parent click and ships no close button of its own.
 * Standalone path (first-run gate): independent window; macOS may use hiddenInset.
 */
export function buildWizardWindowOptions({
  asSheet = false,
  parent = null,
  edit = false,
  platform = process.platform,
  icon,
} = {}) {
  const useSheet = Boolean(asSheet && parent);
  const darwinStandalone = platform === "darwin" && !useSheet;
  return {
    width: useSheet ? 520 : 720,
    height: useSheet ? 560 : 720,
    minWidth: useSheet ? 440 : 560,
    minHeight: useSheet ? 400 : 520,
    title: `${APP_DISPLAY_NAME} · 配置`,
    backgroundColor: "#f7f3ea",
    show: false,
    parent: useSheet ? parent : undefined,
    minimizable: !useSheet,
    maximizable: !useSheet,
    fullscreenable: false,
    titleBarStyle: darwinStandalone ? "hiddenInset" : undefined,
    trafficLightPosition: darwinStandalone ? { x: 16, y: 16 } : undefined,
    ...(icon ? { icon } : {}),
    loadQuery: {
      mode: useSheet ? "sheet" : "onboard",
      // Top-bar pencil button: open settings with the editor already shown.
      ...(useSheet && edit ? { edit: "1" } : {}),
    },
  };
}

export function existingWizardNeedsRebuild(win, { asSheet = false, parent = null } = {}) {
  if (!win || win.isDestroyed?.()) return true;
  const wantSheet = Boolean(asSheet && parent);
  const hasParent = typeof win.getParentWindow === "function" ? Boolean(win.getParentWindow()) : false;
  return wantSheet !== hasParent;
}
