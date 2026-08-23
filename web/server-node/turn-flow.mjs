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

export async function promptWithStallRecovery({
  host,
  message,
  campaignId,
  orchestrator,
  onSse,
}) {
  try {
    return {
      host,
      promptResult: (await host.prompt(message, { onSse })) || {},
    };
  } catch (error) {
    if (error?.kind !== "pi_coc_rpc_idle_timeout") throw error;
    onSse?.({
      event: "status",
      data: {
        phase: "recovering",
        diagnostic: error.details ?? null,
      },
    });
    return orchestrator.recoverStalledTurn(campaignId, {
      onSse,
      recoveryDiagnostic: error.details ?? null,
    });
  }
}

/** Reconcile an already-aborted turn; the caller must not resend its input. */
export async function recoverAbortedTurn({
  campaignId,
  orchestrator,
  onSse,
}) {
  return orchestrator.recoverStalledTurn(campaignId, { onSse });
}

/** Finish a host-owned recovery through the normal delivery/finalize boundary. */
export async function finishRecoveredTurn({
  recovery,
  campaignId,
  orchestrator,
  onSse,
  onDelivery,
  finalize,
}) {
  const { host, promptResult = {} } = recovery;
  host.offerStreamedDelivery(onDelivery);
  return finishPromptTurn({
    host,
    promptResult,
    campaignId,
    orchestrator,
    onSse,
    finalize,
  });
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
