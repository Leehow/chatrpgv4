export const ACTIVE_CAMPAIGN_KEY = "coc-web.campaign";
export const CAMPAIGN_SYNC_CHANNEL = "coc-web.campaign-sync.v1";

export type CampaignViewportSync = {
  start: () => void;
  publish: (campaignId: string | null, sessionId?: string, updated?: boolean) => void;
  stop: () => void;
};

export type CampaignSessionSignal = {
  campaignId: string;
  sessionId: string;
  updated: boolean;
};

type CampaignSessionIdentity = {
  campaign_id: string;
  session_id: string;
};

export async function convergeCampaignViewport(
  signal: CampaignSessionSignal,
  options: {
    currentSession: () => CampaignSessionIdentity | null;
    refreshSession: (session: CampaignSessionIdentity) => Promise<void>;
  },
): Promise<void> {
  const session = options.currentSession();
  if (
    !signal.updated
    || !session
    || session.campaign_id !== signal.campaignId
    || session.session_id !== signal.sessionId
  ) return;
  await options.refreshSession(session);
}

type CampaignViewportSyncOptions = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  channel: Pick<BroadcastChannel, "postMessage" | "addEventListener" | "removeEventListener" | "close">;
  storageEvents: Pick<Window, "addEventListener" | "removeEventListener">;
  onCampaign?: (campaignId: string) => void;
  onSessionUpdated?: (signal: CampaignSessionSignal) => void;
};

export function createCampaignViewportSync(
  options: CampaignViewportSyncOptions,
): CampaignViewportSync {
  let started = false;

  const onMessage = (event: MessageEvent) => {
    const data = event.data as {
      type?: unknown;
      campaignId?: unknown;
      sessionId?: unknown;
      updated?: unknown;
    } | null;
    if (data?.type !== "campaign-selected") return;
    // Foreign selection (list/storage/broadcast) must not open another campaign.
    // Only a same-session settled ping may refresh this document.
    if (
      data.updated === true
      && typeof data.campaignId === "string"
      && data.campaignId.trim()
      && typeof data.sessionId === "string"
      && data.sessionId.trim()
    ) {
      options.onSessionUpdated?.({
        campaignId: data.campaignId.trim(),
        sessionId: data.sessionId.trim(),
        updated: true,
      });
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      options.channel.addEventListener("message", onMessage);
    },
    publish(campaignId, sessionId, updated = false) {
      const selected = campaignId?.trim() || null;
      // Session-settled pings must not rewrite the shared selection key;
      // other documents listen on storage and would steal the viewport.
      if (!updated) {
        if (selected) options.storage.setItem(ACTIVE_CAMPAIGN_KEY, selected);
        else options.storage.removeItem(ACTIVE_CAMPAIGN_KEY);
      }
      options.channel.postMessage({
        type: "campaign-selected",
        campaignId: selected,
        sessionId: sessionId?.trim() || null,
        updated,
      });
    },
    stop() {
      if (!started) return;
      started = false;
      options.channel.removeEventListener("message", onMessage);
      options.channel.close();
    },
  };
}
