import type {
  BootstrapResponse,
  GameState,
  ModelsResponse,
  RuntimeEvent,
  SessionInfo,
  TranscriptMessage,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init);
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!resp.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>("/api/models");
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return request<BootstrapResponse>("/api/bootstrap");
}

export function createCampaign(
  payload:
    | {
        mode?: "starter";
        scenario_id: string;
        pregen_id: string;
        title?: string;
      }
    | {
        mode: "pdf";
        source_bundle_path: string;
        /** Omit or empty when player chose「新建调查员」— main chat runs coc-character. */
        investigator_id?: string;
        title?: string;
        scenario_id?: string;
        campaign_id?: string;
      }
    | {
        mode: "library";
        canonical_module_id: string;
        investigator_id?: string;
        title?: string;
        campaign_id?: string;
      },
): Promise<{
  result: {
    campaign_id: string;
    investigator_id?: string | null;
    needs_investigator?: boolean;
  };
}> {
  return request("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadPdf(file: File): Promise<{
  ok: boolean;
  result: import("./types").PdfUploadResult;
}> {
  const form = new FormData();
  form.append("file", file, file.name);
  const resp = await fetch("/api/uploads/pdf", { method: "POST", body: form });
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!resp.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data as { ok: boolean; result: import("./types").PdfUploadResult };
}

export function createInvestigator(payload: {
  name: string;
  occupation?: string;
  era?: string;
  age?: number;
  investigator_id?: string;
}): Promise<{ result: { investigator_id: string } }> {
  return request("/api/investigators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createSession(campaignId: string): Promise<SessionInfo> {
  return request<SessionInfo>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: campaignId }),
  });
}

export function fetchState(sessionId: string): Promise<GameState> {
  return request<GameState>(`/api/sessions/${sessionId}/state`);
}

export function fetchTranscript(
  sessionId: string,
): Promise<{ messages: TranscriptMessage[] }> {
  return request(`/api/sessions/${sessionId}/transcript`);
}

export interface TurnHandlers {
  onTool?: (phase: string, tool: string) => void;
  onDelta?: (text: string) => void;
  onDeltaReset?: () => void;
  onTurn?: (payload: { events: RuntimeEvent[]; state: GameState }) => void;
  onError?: (message: string) => void;
}

/**
 * Consume one turn over SSE. EventSource cannot POST, so parse the
 * text/event-stream frames manually off the fetch ReadableStream.
 */
export async function streamTurn(
  sessionId: string,
  input: string,
  provider: string,
  model: string,
  handlers: TurnHandlers,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`/api/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, provider, model }),
    });
  } catch {
    handlers.onError?.("无法连接到服务器。");
    return;
  }
  if (!resp.ok || !resp.body) {
    let message = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      if (data && data.error) message = String(data.error);
    } catch {
      /* keep HTTP status */
    }
    handlers.onError?.(message);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
        // ": ping" heartbeats carry no data and are ignored
      }
      if (!dataLines.length) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === "delta") {
        handlers.onDelta?.(String(data.text ?? ""));
      } else if (event === "delta_reset") {
        handlers.onDeltaReset?.();
      } else if (event === "tool") {
        handlers.onTool?.(String(data.phase ?? ""), String(data.tool ?? ""));
      } else if (event === "turn") {
        handlers.onTurn?.(
          data as unknown as { events: RuntimeEvent[]; state: GameState },
        );
      } else if (event === "error") {
        handlers.onError?.(String(data.message ?? "未知错误"));
      } else if (event === "end") {
        return;
      }
    }
  }
}
