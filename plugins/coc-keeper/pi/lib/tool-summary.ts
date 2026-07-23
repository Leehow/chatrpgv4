/**
 * Pure one-line summaries for COC tool TUI rows (no Pi UI imports).
 */

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** One-line arg summary for the tool call row. */
export function summarizeCall(toolName: string, args: unknown): string {
  const obj = asObject(args) ?? {};
  const parts: string[] = [toolName];
  const operation = str(obj.operation);
  if (operation) parts.push(operation);
  const campaign = str(obj.campaign);
  if (campaign) parts.push(campaign);
  const domain = str(obj.domain);
  if (domain) parts.push(`domain=${domain}`);
  if (toolName === "coc_dispatch_source_work") {
    const task = asObject(obj.task);
    const packet = task ? asObject(task.packet) : null;
    const packetId = packet ? str(packet.packet_id) : null;
    if (packetId) parts.push(packetId);
  }
  if (toolName === "coc_progressive_ocr") {
    const pages = Array.isArray(obj.pages) ? obj.pages.length : 0;
    if (pages) parts.push(`${pages} pages`);
  }
  return parts.join(" ");
}

/** One-line result summary when tools are collapsed. */
export function summarizeResult(toolName: string, details: unknown, args?: unknown): string {
  const obj = asObject(details);
  if (!obj) return "done";

  const parts: string[] = [];
  const ok = bool(obj.ok);
  if (ok === true) parts.push("ok");
  else if (ok === false) parts.push("error");

  const status = str(obj.status);
  if (status) parts.push(status);

  const tool = str(obj.tool);
  if (tool) parts.push(tool);

  const opFromArgs = asObject(args);
  const operation = str(obj.operation) ?? (opFromArgs ? str(opFromArgs.operation) : null);
  if (operation && operation !== tool) parts.push(operation);

  const error = asObject(obj.error);
  if (error) {
    const code = str(error.code);
    const message = str(error.message);
    if (code) parts.push(code);
    else if (message) parts.push(message.slice(0, 80));
  } else if (str(obj.error)) {
    parts.push(String(obj.error).slice(0, 80));
  }

  const data = asObject(obj.data);
  if (data) {
    const dataStatus = str(data.status);
    if (dataStatus && dataStatus !== status) parts.push(dataStatus);
    const kind = str(data.kind);
    if (kind) parts.push(kind);
    const result = asObject(data.result);
    if (result) {
      const campaigns = result.campaigns;
      if (Array.isArray(campaigns)) parts.push(`${campaigns.length} campaigns`);
      if (bool(result.workspace_ready) === true) parts.push("workspace ready");
    }
  }

  if (toolName === "coc_dispatch_source_work") {
    const packetId = str(obj.packet_id);
    if (packetId) parts.push(packetId);
    const leafCount = num(obj.leaf_task_count);
    if (leafCount !== null) parts.push(`${leafCount} leaves`);
  }

  if (toolName === "coc_progressive_ocr") {
    const layout = str(obj.layout_noise);
    if (layout) parts.push(`layout=${layout}`);
  }

  return parts.length ? parts.join(" · ") : "done";
}
