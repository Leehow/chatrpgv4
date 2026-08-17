/**
 * Dev-mode brand icon. Packaged builds already get the icns from
 * electron-builder's buildResources; `electron .` launches Electron.app
 * and would otherwise keep the default atom + "Electron" dock label.
 */
import fs from "node:fs";
import path from "node:path";

export const APP_DISPLAY_NAME = "Pi Keeper";

export function resolveAppIconPath({ packaged, appDir }) {
  if (packaged) return null;
  const candidate = path.join(appDir, "buildResources", "icon.png");
  return fs.existsSync(candidate) ? candidate : null;
}
