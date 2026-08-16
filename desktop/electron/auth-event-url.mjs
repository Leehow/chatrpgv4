/** Browser URL from a pi-ai AuthEvent. Same sources the TUI /login dialog shows. */
export function authEventBrowserUrl(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "auth_url" && typeof event.url === "string") return event.url;
  if (event.type === "device_code" && typeof event.verificationUri === "string") {
    return event.verificationUri;
  }
  return null;
}

export function isHttpsUrl(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
