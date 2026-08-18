/** Setup → play handoff transition (pure). Contract field names are binding. */

export const HANDOFF_EVENT_TYPE = "coc_setup_handoff";
export const HANDOFF_TIMEOUT_MS = 60_000;

export const INTERLUDE_COPY = "帷幕即将拉开，守秘人正在开桌……";
export const STALLED_COPY = "开桌似乎耽误了";
export const COMPOSER_PLACEHOLDER = "帷幕尚未拉开。灯还没亮，先把话留在齿间。";

export type SessionRole = "setup" | "play" | null;

export type TransitionPhase = "idle" | "interlude" | "stalled";

export type TransitionState = {
  phase: TransitionPhase;
  startedAt: number | null;
  campaignId: string | null;
};

export const initialTransitionState: TransitionState = {
  phase: "idle",
  startedAt: null,
  campaignId: null,
};

export type CocSetupHandoffEvent = {
  type: typeof HANDOFF_EVENT_TYPE;
  campaign_id?: string;
  receipt?: unknown;
  at?: string | number;
};

export type TransitionInput =
  | { kind: "handoff"; campaign_id?: string; at?: number }
  | {
      kind: "campaign_status";
      session_role: SessionRole;
      transitioning: boolean;
      now?: number;
    }
  | { kind: "tick"; now: number }
  | { kind: "retry"; now?: number };

export function isHandoffEvent(value: unknown): value is CocSetupHandoffEvent {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (rec.type === HANDOFF_EVENT_TYPE) return true;
  const payload = rec.payload;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as { type?: unknown }).type === HANDOFF_EVENT_TYPE,
  );
}

export function handoffCampaignId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.campaign_id === "string") return rec.campaign_id;
  const payload = rec.payload;
  if (payload && typeof payload === "object") {
    const id = (payload as { campaign_id?: unknown }).campaign_id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function beginInterlude(campaignId: string | null, now: number): TransitionState {
  return { phase: "interlude", startedAt: now, campaignId };
}

export function reduceTransition(
  state: TransitionState,
  input: TransitionInput,
): TransitionState {
  if (input.kind === "handoff") {
    return beginInterlude(input.campaign_id ?? state.campaignId, input.at ?? Date.now());
  }

  if (input.kind === "campaign_status") {
    const now = input.now ?? Date.now();
    if (input.transitioning === true) {
      if (state.phase === "stalled") return state;
      if (state.phase === "interlude") return state;
      return beginInterlude(state.campaignId, now);
    }
    if (input.transitioning === false && input.session_role === "play") {
      return { phase: "idle", startedAt: null, campaignId: state.campaignId };
    }
    return state;
  }

  if (input.kind === "tick") {
    if (state.phase !== "interlude" || state.startedAt == null) return state;
    if (input.now - state.startedAt >= HANDOFF_TIMEOUT_MS) {
      return { ...state, phase: "stalled" };
    }
    return state;
  }

  if (input.kind === "retry") {
    if (state.phase !== "stalled") return state;
    return beginInterlude(state.campaignId, input.now ?? Date.now());
  }

  return state;
}

export function composerLocked(state: TransitionState): boolean {
  return state.phase !== "idle";
}
