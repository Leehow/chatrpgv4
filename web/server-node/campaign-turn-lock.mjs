/**
 * Serialize keeper turns per campaign only.
 * Different campaigns may run concurrently; one campaign must not.
 */
export function createCampaignTurnLock() {
  const inflight = new Set();
  return {
    tryAcquire(campaignId) {
      const id = String(campaignId || "").trim();
      if (!id || inflight.has(id)) return false;
      inflight.add(id);
      return true;
    },
    release(campaignId) {
      inflight.delete(String(campaignId || "").trim());
    },
    isBusy(campaignId) {
      return inflight.has(String(campaignId || "").trim());
    },
  };
}
