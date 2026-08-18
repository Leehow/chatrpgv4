/**
 * Keep one player turn open while setup exit-42 becomes the play opening.
 * This is transport sequencing only; Keeper decisions remain inside pi-coc.
 */
export function needsSetupHandoff({ host, promptResult, transitioning = false } = {}) {
  return Boolean(
    promptResult?.handoff
    || host?.isHandoffShutdown?.()
    || transitioning,
  );
}

export async function finishPromptTurn({
  host,
  promptResult,
  campaignId,
  orchestrator,
  onSse,
  finalize,
}) {
  let activeHost = host;
  if (needsSetupHandoff({
    host,
    promptResult,
    transitioning: orchestrator.isTransitioning(campaignId),
  })) {
    activeHost = await orchestrator.completeHandoffOpening(campaignId, {
      reason: "exit_42",
      onSse,
    });
  }
  await finalize(activeHost);
  return activeHost;
}
