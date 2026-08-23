export type CampaignMessageOwner = {
  campaignId: string | null;
  generation: number;
};

export type CampaignMessageToken = {
  campaignId: string;
  generation: number;
};

export function initialCampaignMessageOwner(): CampaignMessageOwner {
  return { campaignId: null, generation: 0 };
}

export function beginCampaignMessageOpen(
  current: CampaignMessageOwner,
  campaignId: string,
): {
  owner: CampaignMessageOwner;
  token: CampaignMessageToken;
  clearMessages: boolean;
} {
  const owner = {
    campaignId,
    generation: current.generation + 1,
  };
  return {
    owner,
    token: owner,
    clearMessages: current.campaignId !== campaignId,
  };
}

export function ownsCampaignMessageToken(
  current: CampaignMessageOwner,
  token: CampaignMessageToken,
): boolean {
  return current.campaignId === token.campaignId
    && current.generation === token.generation;
}

export function releaseCampaignMessages(
  current: CampaignMessageOwner,
): CampaignMessageOwner {
  return {
    campaignId: null,
    generation: current.generation + 1,
  };
}
