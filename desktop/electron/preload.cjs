// CommonJS on purpose: sandboxed renderers (Electron 20+ default) only
// support CommonJS preloads. Minimal typed bridge, no node integration.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cocWizard", {
  getState: () => ipcRenderer.invoke("wizard:getState"),
  saveProvider: (payload) => ipcRenderer.invoke("wizard:saveProvider", payload),
  fetchModels: (payload) => ipcRenderer.invoke("wizard:fetchModels", payload),
  finishOnboarding: () => ipcRenderer.invoke("wizard:finishOnboarding"),
  saveProviderList: (payload) => ipcRenderer.invoke("wizard:saveProviderList", payload),
  openItem: (target) => ipcRenderer.invoke("wizard:openItem", target),
  openUrl: (url) => ipcRenderer.invoke("wizard:openUrl", url),
  // pi-style provider login (OAuth browser flow / API key), driven by the
  // bundled pi library in the main process.
  loginProvider: (providerId, method) =>
    ipcRenderer.invoke("auth:login", { providerId, method }),
  respondPrompt: (promptId, value, cancel) =>
    ipcRenderer.invoke("auth:respond", { promptId, value, cancel }),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel"),
  onAuthEvent: (callback) => subscribe("auth:event", callback),
  onAuthPrompt: (callback) => subscribe("auth:prompt", callback),
  onAuthPromptDismissed: (callback) => subscribe("auth:promptDismissed", callback),
});

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
