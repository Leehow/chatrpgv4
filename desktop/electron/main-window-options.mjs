/**
 * Pure BrowserWindow options for the COC Keeper main window.
 * Darwin hides the native title text via hiddenInset so traffic lights sit
 * in the in-app cream header; other platforms keep default chrome.
 */
export function buildMainWindowOptions({ platform = process.platform } = {}) {
  const darwin = platform === "darwin";
  return {
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "COC Keeper",
    backgroundColor: "#f5f1e8",
    titleBarStyle: darwin ? "hiddenInset" : undefined,
    trafficLightPosition: darwin ? { x: 16, y: 20 } : undefined,
  };
}
