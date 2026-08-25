/**
 * current-dependency-machine
 *
 * Extracted from the Pi-Coc host facade.  The facade injects the stable host
 * environment once, then installs this cohesive method set on its unchanged
 * public prototype.  Ordinary edits therefore stay in this owned module
 * without reopening the shared extension facade.
 */

type CurrentDependencyWait = any;
type JsonObject = any;

export type CurrentDependencyMachineStateSurface = {
  readonly currentDependencyWaits: Map<string, CurrentDependencyWait>;
  readonly currentDependencyByDispatch: Map<string, string>;
  currentDependencySuppression: any | null;
  currentVisibleCampaignId: string | null;
};

const currentDependencyState = new WeakMap<
  object,
  CurrentDependencyMachineStateSurface
>();

function stateFor(host: object): CurrentDependencyMachineStateSurface {
  let state = currentDependencyState.get(host);
  if (state === undefined) {
    state = {
      currentDependencyWaits: new Map(),
      currentDependencyByDispatch: new Map(),
      currentDependencySuppression: null,
      currentVisibleCampaignId: null,
    };
    currentDependencyState.set(host, state);
  }
  return state;
}

export function installCurrentDependencyMachineState(
  prototype: object,
): void {
  Object.defineProperties(prototype, {
    currentDependencyWaits: {
      get(this: object) { return stateFor(this).currentDependencyWaits; },
    },
    currentDependencyByDispatch: {
      get(this: object) { return stateFor(this).currentDependencyByDispatch; },
    },
    currentDependencySuppression: {
      get(this: object) { return stateFor(this).currentDependencySuppression; },
      set(this: object, value: any | null) {
        stateFor(this).currentDependencySuppression = value;
      },
    },
    currentVisibleCampaignId: {
      get(this: object) { return stateFor(this).currentVisibleCampaignId; },
      set(this: object, value: string | null) {
        stateFor(this).currentVisibleCampaignId = value;
      },
    },
  });
}

export function createCurrentDependencyMachineMethods(
  environment: Record<string, any>,
) {
  const {
    canonicalJsonValueSha256,
    objectOrNull,
  } = environment;
  return {

  removeCurrentDependency(this: any, dependencyId: string): void {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey) {
      this.currentDependencyByDispatch.delete(wait.dispatchKey);
      this.states.delete(wait.dispatchKey);
      this.dispatchClasses.delete(wait.dispatchKey);
    }
    this.currentDependencyWaits.delete(dependencyId);
    if (
      wait !== undefined
      && ![...this.currentDependencyWaits.values()].some(
        (candidate) => candidate.campaignId === wait.campaignId,
      )
      && this.currentDependencySuppression?.campaignId === wait.campaignId
    ) {
      this.currentDependencySuppression = null;
    }
  },


  currentDependencySettlementGroupKey(this: any,
    campaignId: string,
    dependencyRef: JsonObject,
  ): string | null {
    const operation = typeof dependencyRef.operation === "string"
      ? dependencyRef.operation.trim()
      : "";
    const identity: Array<[string, string]> = [];
    for (
      const field of [
        "decision_id", "settlement_id", "source_scope_signature",
      ]
    ) {
      const value = typeof dependencyRef[field] === "string"
        ? dependencyRef[field].trim()
        : "";
      if (value) identity.push([field, value]);
    }
    if (!campaignId || !operation || identity.length !== 1) return null;
    return canonicalJsonValueSha256({
      campaign_id: campaignId,
      operation,
      settlement_identity: identity[0],
    });
  },


  observeCurrentDependencySnapshot(this: any,
    campaignId: string,
    waits: JsonObject[],
    snapshotScope: JsonObject | null = null,
  ): void {
    const retained = new Set<string>();
    const scopedDependencyRef = objectOrNull(
      snapshotScope?.dependency_ref,
    );
    const scopedSettlementGroupKey = scopedDependencyRef === null
      ? null
      : this.currentDependencySettlementGroupKey(
        campaignId,
        scopedDependencyRef,
      );
    for (const value of waits) {
      const waitCampaignId = typeof value.campaign_id === "string"
        ? value.campaign_id.trim()
        : "";
      const dependencyId = typeof value.dependency_id === "string"
        ? value.dependency_id.trim()
        : "";
      const jobId = typeof value.job_id === "string"
        ? value.job_id.trim()
        : "";
      const dependencyRef = objectOrNull(value.dependency_ref);
      const settlementGroupKey = dependencyRef === null
        ? null
        : this.currentDependencySettlementGroupKey(campaignId, dependencyRef);
      if (
        !campaignId
        || waitCampaignId !== campaignId
        || !dependencyId
        || !jobId
        || dependencyRef === null
        || settlementGroupKey === null
      ) continue;
      retained.add(dependencyId);
      const existing = this.currentDependencyWaits.get(dependencyId);
      if (existing?.jobId !== jobId && existing?.dispatchKey) {
        this.currentDependencyByDispatch.delete(existing.dispatchKey);
        this.states.delete(existing.dispatchKey);
        this.dispatchClasses.delete(existing.dispatchKey);
      }
      this.currentDependencyWaits.set(dependencyId, {
        campaignId,
        jobId,
        dependencyRef,
        settlementGroupKey,
        dispatchKey: existing?.jobId === jobId
          ? existing.dispatchKey
          : null,
        deliveryPending: existing?.jobId === jobId
          ? existing.deliveryPending
          : false,
        deliveryRetryNeeded: existing?.jobId === jobId
          ? existing.deliveryRetryNeeded
          : false,
        terminalReceipt: existing?.jobId === jobId
          ? existing.terminalReceipt
          : null,
        terminalDelivered: existing?.jobId === jobId
          ? existing.terminalDelivered
          : false,
        projectionConfirmed: existing?.jobId === jobId
          ? existing.projectionConfirmed
          : false,
      });
    }
    for (const [dependencyId, wait] of this.currentDependencyWaits) {
      if (
        wait.campaignId === campaignId
        && (
          scopedSettlementGroupKey === null
          || wait.settlementGroupKey === scopedSettlementGroupKey
        )
        && !retained.has(dependencyId)
        && !wait.deliveryPending
        && !wait.terminalDelivered
      ) {
        this.removeCurrentDependency(dependencyId);
      }
    }
  },


  currentDependencyDeliveryPending(this: any,
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): boolean {
    const wait = this.currentDependencyWaits.get(dependencyId);
    return (
      wait?.jobId === jobId
      && wait.dispatchKey === dispatchKey
      && wait.terminalReceipt !== null
      && (wait.deliveryPending || wait.terminalDelivered)
    );
  },


  prepareCurrentDependencyDispatch(this: any,
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): boolean {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (
      wait === undefined
      || wait.jobId !== jobId
      || !dispatchKey
    ) return false;
    if (wait.dispatchKey && wait.dispatchKey !== dispatchKey) {
      this.currentDependencyByDispatch.delete(wait.dispatchKey);
      this.states.delete(wait.dispatchKey);
      this.dispatchClasses.delete(wait.dispatchKey);
      wait.deliveryPending = false;
      wait.deliveryRetryNeeded = false;
      wait.terminalReceipt = null;
      wait.terminalDelivered = false;
      wait.projectionConfirmed = false;
    }
    wait.dispatchKey = dispatchKey;
    this.currentDependencyByDispatch.set(dispatchKey, dependencyId);
    this.states.set(dispatchKey, "awaiting");
    this.dispatchClasses.set(dispatchKey, "blocking_micro");
    return true;
  },


  rollbackCurrentDependencySubmission(this: any,
    dependencyId: string,
    jobId: string,
    dispatchKey: string,
  ): void {
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.jobId !== jobId || wait.dispatchKey !== dispatchKey) return;
    wait.dispatchKey = null;
    wait.deliveryPending = false;
    wait.deliveryRetryNeeded = false;
    wait.terminalReceipt = null;
    wait.terminalDelivered = false;
    wait.projectionConfirmed = false;
    this.currentDependencyByDispatch.delete(dispatchKey);
    this.states.delete(dispatchKey);
    this.dispatchClasses.delete(dispatchKey);
  },


  commitCurrentDependencyDelivery(this: any, dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    this.removeCurrentDependency(dependencyId);
  },


  markCurrentDependencyTerminalDelivered(this: any, dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (
      wait?.dispatchKey !== dispatchKey
      || wait.terminalReceipt?.status !== "fulfilled"
    ) return;
    wait.deliveryPending = false;
    wait.deliveryRetryNeeded = false;
    wait.terminalDelivered = true;
    this.states.set(dispatchKey, "published");
  },


  observeCurrentDependencyTerminalReceipt(this: any,
    dispatchKey: string,
    receipt: JsonObject,
  ): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined || receipt.status !== "fulfilled") return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey !== dispatchKey) return;
    wait.terminalReceipt = receipt;
  },


  rollbackCurrentDependencyDelivery(this: any, dispatchKey: string): void {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    if (dependencyId === undefined) return;
    const wait = this.currentDependencyWaits.get(dependencyId);
    if (wait?.dispatchKey !== dispatchKey || !wait.deliveryPending) return;
    wait.deliveryRetryNeeded = wait.terminalReceipt !== null;
    this.states.set(dispatchKey, "awaiting");
    this.dispatchClasses.set(dispatchKey, "blocking_micro");
  },


  takeCurrentDependencyDeliveryRetries(this: any): Array<{
    dispatchKey: string;
    receipt: JsonObject;
  }> {
    const retries: Array<{ dispatchKey: string; receipt: JsonObject }> = [];
    for (const wait of this.currentDependencyWaits.values()) {
      if (
        wait.dispatchKey === null
        || !wait.deliveryPending
        || !wait.deliveryRetryNeeded
        || wait.terminalReceipt === null
      ) continue;
      wait.deliveryRetryNeeded = false;
      retries.push({
        dispatchKey: wait.dispatchKey,
        receipt: wait.terminalReceipt,
      });
    }
    return retries;
  },


  observeCurrentVisibleInvocation(this: any,
    invocationId: string,
    campaignId: string,
  ): void {
    if (invocationId && campaignId) {
      this.currentVisibleCampaignId = campaignId;
    }
  },


  exactDependencyRefMatches(this: any,
    wait: CurrentDependencyWait,
    campaignId: string,
    operation: unknown,
    identity: JsonObject,
    subjectKind?: unknown,
    subjectId?: unknown,
  ): boolean {
    const identityFields = [
      "decision_id", "settlement_id", "source_scope_signature",
    ].filter((field) => (
      typeof wait.dependencyRef[field] === "string"
      && String(wait.dependencyRef[field]).trim()
    ));
    if (
      campaignId !== wait.campaignId
      || operation !== wait.dependencyRef.operation
      || identityFields.length !== 1
      || identity[identityFields[0]] !== wait.dependencyRef[identityFields[0]]
    ) {
      return false;
    }
    if (subjectKind === undefined && subjectId === undefined) return true;
    const subject = objectOrNull(wait.dependencyRef.subject);
    return (
      subjectKind !== undefined
      && subjectId !== undefined
      && subjectKind === subject?.kind
      && subjectId === subject?.id
    );
  },


  currentDependencyToolError(this: any, params: JsonObject): string | null {
    const campaignId = typeof params.campaign === "string"
      ? params.campaign.trim()
      : "";
    const operation = typeof params.operation === "string"
      ? params.operation.trim()
      : "";
    if (!campaignId || !operation) return null;
    const args = objectOrNull(params.arguments) ?? {};
    const active = [...this.currentDependencyWaits.values()].filter(
      (wait) => wait.campaignId === campaignId && wait.terminalDelivered,
    );
    if (active.length === 0) return null;
    const exactRecovery = active.some((wait) => {
      const subject = objectOrNull(wait.dependencyRef.subject);
      return (
        operation === "scene.context"
        || (
          operation === "progressive.status"
          && args.kind === subject?.kind
          && args.target_id === subject?.id
        )
      );
    });
    if (exactRecovery) return null;
    const exactConsumerReady = active.some((wait) => (
      wait.projectionConfirmed
      && this.exactDependencyRefMatches(
        wait,
        campaignId,
        operation,
        args,
        args.kind,
        args.target_id,
      )
    ));
    if (exactConsumerReady) return null;
    return (
      `${operation} is blocked until the fulfilled current dependency is `
      + "consumed through its exact canonical projection query; do not "
      + "release or reconstruct source facts from earlier previews"
    );
  },


  observeCurrentDependencyConsumerResult(this: any,
    operation: string,
    params: JsonObject,
    value: unknown,
  ): void {
    const envelope = objectOrNull(value);
    if (envelope?.ok !== true) return;
    const campaignId = typeof params.campaign === "string"
      ? params.campaign.trim()
      : "";
    if (!campaignId) return;
    const data = objectOrNull(envelope.data);
    const args = objectOrNull(params.arguments) ?? {};
    for (const [dependencyId, wait] of this.currentDependencyWaits) {
      if (wait.campaignId !== campaignId || !wait.terminalDelivered) continue;
      const subject = objectOrNull(wait.dependencyRef.subject);
      const subjectKind = typeof subject?.kind === "string"
        ? subject.kind
        : "";
      const subjectId = typeof subject?.id === "string" ? subject.id : "";
      if (!subjectKind || !subjectId) continue;
      if (operation === "scene.context" && subjectKind === "location") {
        const scene = objectOrNull(data?.scene);
        if (
          data?.active_scene_id === subjectId
          && ["deep", "body_parsed"].includes(String(scene?.parse_state ?? ""))
          && scene?.evidence_gap === false
        ) {
          wait.projectionConfirmed = true;
        }
      }
      if (
        wait.projectionConfirmed
        && this.exactDependencyRefMatches(
          wait,
          campaignId,
          operation,
          args,
          args.kind,
          args.target_id,
        )
      ) {
        this.removeCurrentDependency(dependencyId);
      }
    }
  },
  };
}

export type CurrentDependencyMachineMethods = ReturnType<
  typeof createCurrentDependencyMachineMethods
>;
