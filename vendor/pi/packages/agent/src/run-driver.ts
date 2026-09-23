/**
 * RunDriver: one driver per input, one step at a time.
 *
 * The model-first loop (`runLoop` in `agent-loop.ts`) makes a provider request the entry of every
 * iteration. The RunDriver instead asks a pure policy for the next step over the current run view and
 * performs exactly that step:
 *
 * - `decide`  one bounded semantic judgment through the injected decision port; its answer is a
 *             decision artifact, never an assistant message, usage record or tool result;
 * - `infer`   one real model response through the agent's own provider path (the same stream function,
 *             request preparation and hooks the model-first loop uses); its tool calls are not executed
 *             here but become pending proposals of the run;
 * - `operate` proposals executed in order through the operations/read ports; a model proposal still
 *             yields the real tool result paired with the model's call;
 * - `scope`   entering or leaving a logical frame of the same run (never a recursive run);
 * - `wait`    yielding the run until a condition, recorded, not polled;
 * - `finish`  closing the run against the evidence it gathered.
 *
 * Step identity (`stepId`) is separate from provider-attempt identity (`attemptId`): a retried request
 * is a new attempt of the same step, never a new step or a new game action. Abort revokes permission at
 * once: a decide/operate wait resolves as aborted when the signal fires, its late result is discarded,
 * and nothing runs after it.
 *
 * This module knows no domain: questions, proposals and artifacts are opaque values the ports and the
 * policy agree on.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentMessage, AgentToolCall } from "./types.ts";

/** Loop protocol the driver implements; recorded in the startup record of a host that selects it. */
export const RUN_LOOP_PROTOCOL = "hybrid-v1";
/** Schema version carried by every run/step/scope/operation/delivery event. */
export const RUN_EVENT_SCHEMA_VERSION = 1;

export type StepKind = "decide" | "infer" | "operate" | "scope" | "wait" | "finish";
/** Where a step or proposal came from. Tracing only: it never grants permission. */
export type StepOrigin = "policy" | "model" | "user-command";
/** Who may be shown an event: the run's internals, the model's side of the table, or the player. */
export type StepVisibility = "internal" | "keeper" | "player";
export type InferPurpose = "plan" | "adjudicate" | "bind" | "compose" | "review" | "compact";
export type DeliveryState = "none" | "draft" | "reviewed" | "accepted" | "awaiting_player";
export type ObservationStatus = "ok" | "refused" | "unavailable" | "stale" | "aborted";
/** How a run ended. `delivered` and `awaiting_player` need delivery evidence; a finish without it is `undelivered`. */
export type RunStatus = "delivered" | "awaiting_player" | "waiting" | "undelivered" | "aborted" | "failed";

/** One operation a step asks to perform. */
export interface OperationProposal {
	origin: StepOrigin;
	/** Operation name the ports understand (a model proposal carries the tool name). */
	operation: string;
	params?: unknown;
	/** A read-only proposal publishes nothing and changes no state. */
	readOnly?: boolean;
	label?: string;
	/** Model-origin only: the real tool call and the response that made it. */
	toolCall?: AgentToolCall;
	assistantMessage?: AssistantMessage;
	/** False when the response was cut at the output limit: refused, never executed. */
	executable?: boolean;
}

export type StepRequest =
	| { kind: "decide"; purpose: string; question: unknown; reason?: string }
	| { kind: "infer"; purpose: InferPurpose; reason: string; request?: unknown }
	| { kind: "operate"; proposals: readonly OperationProposal[]; reason?: string }
	| { kind: "scope"; transition: "enter" | "exit"; scopeId: string; spec?: unknown }
	| { kind: "wait"; condition: unknown; reason?: string }
	| { kind: "finish"; outcome: RunStatus; reason: string };

/** The result of one step, as the policy sees it. */
export interface ObservationView {
	readonly id: string;
	readonly stepId: string;
	readonly producerStepId: string;
	readonly sequence: number;
	readonly kind: StepKind;
	readonly purpose?: string;
	readonly origin: StepOrigin;
	readonly status: ObservationStatus;
	/** Runtime-issued reference of the artifact (`<stepId>/<kind>`). */
	readonly artifactRef: string;
	/** The artifact itself: a decision, an operation outcome, a scope transition. Opaque to the driver. */
	readonly artifact?: unknown;
	/** infer: the real assistant message the provider produced. */
	readonly message?: AssistantMessage;
	/** infer: the model's proposals, in order, as they were handed to the run. */
	readonly proposals?: readonly OperationProposal[];
	/** operate: the real tool results paired with model proposals. */
	readonly toolResults?: readonly ToolResultMessage[];
	/** operate: the per-proposal outcomes, in proposal order. */
	readonly outcomes?: readonly OperationOutcome[];
	readonly delivery?: "accepted" | "awaiting_player";
	readonly reason?: string;
	readonly ms: number;
}

export interface RunInput {
	readonly runId: string;
	/** Binds every decision and proposal of the run to this input; a new input revokes the run. */
	readonly inputRevision: string;
	/** The player's text as it arrived; authorization reads it, never a projection of it. */
	readonly rawInput: string;
	readonly scopeId: string;
}

export interface RunView<S = unknown> {
	readonly runId: string;
	readonly inputRevision: string;
	readonly rawInput: string;
	readonly activeScopeId: string;
	/** Increments with every settled step. */
	readonly stateVersion: number;
	readonly observations: readonly ObservationView[];
	/** Model proposals not yet executed. While any exist the only legal steps are operating them or finishing. */
	readonly pendingProposals: readonly OperationProposal[];
	readonly pendingRequirements: readonly string[];
	readonly delivery: DeliveryState;
	readonly steps: number;
	readonly lastObservation?: ObservationView;
	/** The policy's own state, folded from observations by `RunPolicy.reduce`. */
	readonly policyState: S;
}

/** The policy: pure functions over the view. No network, no world writes, no nested runs. */
export interface RunPolicy<S = unknown> {
	readonly name: string;
	readonly version: string;
	initial(input: RunInput): S;
	next(view: RunView<S>): StepRequest;
	reduce(state: S, observation: ObservationView, view: RunView<S>): S;
}

export interface DecideRequest {
	runId: string;
	stepId: string;
	purpose: string;
	question: unknown;
	inputRevision: string;
	scopeId: string;
	signal: AbortSignal;
}
export interface DecisionOutcome {
	status: "ok" | "refused" | "unavailable";
	/** The decision artifact (answers, distributions, costs). Never a message. */
	artifact?: unknown;
}
/** Bounded semantic judgment (the product's Jev). */
export interface DecisionPort {
	decide(request: DecideRequest): Promise<DecisionOutcome>;
}

export interface OperationInvocation {
	runId: string;
	stepId: string;
	operationId: string;
	origin: StepOrigin;
	inputRevision: string;
	scopeId: string;
	signal: AbortSignal;
	/** Model-origin only: the agent's tool pipeline (hooks, validation, the real tool) for this call. */
	executeModelTool?: () => Promise<ToolResultMessage>;
}
export interface OperationOutcome {
	status: "ok" | "refused" | "unavailable";
	artifact?: unknown;
	/** Set by the port when this operation committed the delivery or handed a choice back to the player. */
	delivery?: "accepted" | "awaiting_player";
	/** Model-origin: the result paired with the model's call. */
	toolResult?: ToolResultMessage;
	reason?: string;
}
export interface OperationsPort {
	execute(proposal: OperationProposal, invocation: OperationInvocation): Promise<OperationOutcome>;
}
/** Read-only operations (`operation: "read"`); a read publishes nothing. */
export interface ReadPort {
	read(proposal: OperationProposal, invocation: OperationInvocation): Promise<OperationOutcome>;
}
/** What an infer receives beyond the transcript: host-verified observations as real (persisted) messages. */
export interface ProjectionPort {
	project(request: {
		view: RunView;
		step: Extract<StepRequest, { kind: "infer" }>;
		stepId: string;
		signal: AbortSignal;
	}): AgentMessage[] | undefined | Promise<AgentMessage[] | undefined>;
}
export interface RecordPort {
	record(event: RunEvent, detail?: unknown): void;
}
export interface ClockPort {
	now(): number;
}

export interface RunDriverPorts {
	/** Absent or unanswering: every decide observes `unavailable` and the policy degrades it to an infer. */
	decision?: DecisionPort;
	operations?: OperationsPort;
	read?: ReadPort;
	projection?: ProjectionPort;
	record?: RecordPort;
	clock?: ClockPort;
}

/** The model side of the run, provided by the agent that owns the provider path and the tools. */
export interface InferEngine {
	/**
	 * One model step. May make several provider attempts (retry, overflow recovery) but commits at most
	 * one final assistant message, which it returns.
	 */
	infer(request: {
		stepId: string;
		purpose: InferPurpose;
		prepend: AgentMessage[];
		signal: AbortSignal;
		onAttempt: (attempt: number) => void | Promise<void>;
	}): Promise<AssistantMessage>;
	/** Run one real model tool call through the agent's tool pipeline and return its result. */
	executeModelTool(proposal: OperationProposal, signal: AbortSignal): Promise<ToolResultMessage>;
	/** Answer a real model tool call with an explicit refusal that states it was not executed. */
	refuseModelTool(proposal: OperationProposal, reason: string): Promise<ToolResultMessage>;
	/** Close the model turn (the response and all its results are in). Returns what the turn boundary asked for. */
	closeTurn(message: AssistantMessage, toolResults: ToolResultMessage[]): Promise<{ continueRequested: boolean }>;
}

interface RunEventBase {
	runId: string;
	stepId?: string;
	sequence: number;
	scopeId: string;
	origin: StepOrigin;
	visibility: StepVisibility;
	schemaVersion: number;
	at: number;
}
export type RunEvent =
	| (RunEventBase & {
			type: "run_start";
			inputRevision: string;
			protocol: string;
			policy: { name: string; version: string };
	  })
	| (RunEventBase & { type: "run_end"; status: RunStatus; reason: string; steps: number; error?: string })
	| (RunEventBase & { type: "step_start"; kind: StepKind; purpose?: string; ref: string })
	| (RunEventBase & { type: "step_attempt"; kind: "infer"; attemptId: string; attempt: number })
	| (RunEventBase & {
			type: "step_end";
			kind: StepKind;
			purpose?: string;
			status: ObservationStatus;
			artifactRef: string;
			ms: number;
			reason?: string;
	  })
	| (RunEventBase & { type: "scope_enter" | "scope_exit"; parentScopeId: string })
	| (RunEventBase & {
			type: "operation_prepared";
			operationId: string;
			operation: string;
			readOnly: boolean;
			label?: string;
			toolCallId?: string;
	  })
	| (RunEventBase & {
			type: "operation_settled";
			operationId: string;
			operation: string;
			status: "ok" | "refused" | "unavailable" | "aborted";
			toolCallId?: string;
			reason?: string;
	  })
	| (RunEventBase & {
			type: "delivery_accepted";
			delivery: "accepted" | "awaiting_player";
			operationId: string;
	  });
export type RunEventType = RunEvent["type"];
export const RUN_EVENT_TYPES: readonly RunEventType[] = Object.freeze([
	"run_start",
	"run_end",
	"step_start",
	"step_attempt",
	"step_end",
	"scope_enter",
	"scope_exit",
	"operation_prepared",
	"operation_settled",
	"delivery_accepted",
]);
export function isRunEvent(event: { type: string }): event is RunEvent {
	return (RUN_EVENT_TYPES as readonly string[]).includes(event.type);
}

export interface DrivenRunResult {
	runId: string;
	status: RunStatus;
	reason: string;
	steps: number;
	observations: readonly ObservationView[];
	error?: string;
}

export interface RunDriverOptions<S = unknown> {
	input: RunInput;
	policy: RunPolicy<S>;
	ports?: RunDriverPorts;
	engine: InferEngine;
	emit: (event: RunEvent) => Promise<void> | void;
	signal: AbortSignal;
	/** Hard cap on steps; a run that reaches it fails instead of spinning. Default 64. */
	maxSteps?: number;
}

const ABORTED = Symbol("aborted");

/** Resolve with the value, or with ABORTED the moment the signal fires; a late value is discarded. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
	if (signal.aborted) {
		work.catch(() => {});
		return Promise.resolve(ABORTED);
	}
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			work.catch(() => {});
			resolve(ABORTED);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		work.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				if (signal.aborted) resolve(ABORTED);
				else resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				if (signal.aborted) resolve(ABORTED);
				else reject(error);
			},
		);
	});
}

function sameProposals(requested: readonly OperationProposal[], pending: readonly OperationProposal[]): boolean {
	return (
		requested.length === pending.length &&
		requested.every(
			(proposal, index) =>
				proposal.origin === "model" &&
				proposal.toolCall !== undefined &&
				proposal.toolCall.id === pending[index].toolCall?.id,
		)
	);
}

class PolicyViolation extends Error {}

/**
 * Drive one run to its end. Never throws for a step failure: the run ends `failed` with the reason.
 * Throws only when emitting an event itself fails (the host cannot be told).
 */
export async function runDriver<S>(options: RunDriverOptions<S>): Promise<DrivenRunResult> {
	const { input, policy, engine, signal } = options;
	const ports = options.ports ?? {};
	const clock = ports.clock ?? { now: () => Date.now() };
	const maxSteps = options.maxSteps ?? 64;
	let sequence = 0;
	let steps = 0;
	let stateVersion = 0;
	let scopeStack: string[] = [input.scopeId];
	let delivery: DeliveryState = "none";
	let pendingProposals: OperationProposal[] = [];
	let openTurn: { message: AssistantMessage; results: ToolResultMessage[] } | undefined;
	let policyState = policy.initial(input);
	const observations: ObservationView[] = [];
	const requirements = new Set<string>();

	const scopeId = () => scopeStack[scopeStack.length - 1];
	const send = async (
		event: Record<string, unknown> & { type: RunEventType },
		meta: { stepId?: string; origin?: StepOrigin; visibility?: StepVisibility } = {},
	) => {
		const full = {
			...event,
			runId: input.runId,
			...(meta.stepId ? { stepId: meta.stepId } : {}),
			sequence: ++sequence,
			scopeId: scopeId(),
			origin: meta.origin ?? "policy",
			visibility: meta.visibility ?? "internal",
			schemaVersion: RUN_EVENT_SCHEMA_VERSION,
			at: clock.now(),
		} as RunEvent;
		try {
			ports.record?.record(full);
		} catch {
			// Recording never steers the run.
		}
		await options.emit(full);
	};
	const view = (): RunView<S> =>
		Object.freeze({
			runId: input.runId,
			inputRevision: input.inputRevision,
			rawInput: input.rawInput,
			activeScopeId: scopeId(),
			stateVersion,
			observations: Object.freeze(observations.slice()),
			pendingProposals: Object.freeze(pendingProposals.slice()),
			pendingRequirements: Object.freeze([...requirements]),
			delivery,
			steps,
			lastObservation: observations[observations.length - 1],
			policyState,
		});

	const end = async (status: RunStatus, reason: string, error?: string): Promise<DrivenRunResult> => {
		await send({ type: "run_end", status, reason, steps, ...(error ? { error } : {}) });
		return { runId: input.runId, status, reason, steps, observations: observations.slice(), ...(error ? { error } : {}) };
	};

	await send({ type: "run_start", inputRevision: input.inputRevision, protocol: RUN_LOOP_PROTOCOL, policy: { name: policy.name, version: policy.version } });

	try {
		for (;;) {
			if (signal.aborted) return await end("aborted", "aborted_between_steps");
			if (steps >= maxSteps) return await end("failed", "step_limit");
			const current = view();
			const request = policy.next(current);
			validate(request, current);
			const stepId = `${input.runId}:s${++steps}`;
			const began = clock.now();
			const purpose = "purpose" in request ? request.purpose : request.kind === "finish" ? request.outcome : undefined;
			const origin: StepOrigin = request.kind === "operate" && request.proposals.every((p) => p.origin === "model") ? "model" : "policy";
			const artifactRef = `${stepId}/${request.kind}`;
			await send({ type: "step_start", kind: request.kind, ...(purpose ? { purpose } : {}), ref: artifactRef }, { stepId, origin });

			if (request.kind === "finish") {
				const evidenced =
					request.outcome === "delivered"
						? delivery === "accepted"
						: request.outcome === "awaiting_player"
							? delivery === "awaiting_player"
							: true;
				const status: RunStatus = evidenced ? request.outcome : "undelivered";
				const reason = evidenced ? request.reason : `${request.reason}:no_${request.outcome}_evidence`;
				await send({ type: "step_end", kind: "finish", purpose: request.outcome, status: "ok", artifactRef, ms: clock.now() - began, reason }, { stepId });
				return await end(status, reason);
			}

			let observation: ObservationView;
			if (request.kind === "decide") {
				let outcome: DecisionOutcome | typeof ABORTED;
				if (!ports.decision) outcome = { status: "unavailable", artifact: { reason: "no_decision_port" } };
				else {
					try {
						outcome = await untilAborted(
							ports.decision.decide({ runId: input.runId, stepId, purpose: request.purpose, question: request.question, inputRevision: input.inputRevision, scopeId: scopeId(), signal }),
							signal,
						);
					} catch (error) {
						outcome = { status: "unavailable", artifact: { reason: "decision_failed", error: String(error instanceof Error ? error.message : error) } };
					}
				}
				if (outcome === ABORTED) {
					await send({ type: "step_end", kind: "decide", purpose: request.purpose, status: "aborted", artifactRef, ms: clock.now() - began }, { stepId });
					return await end("aborted", "aborted_during_decide");
				}
				observation = { id: artifactRef, stepId, producerStepId: stepId, sequence: steps, kind: "decide", purpose: request.purpose, origin: "policy", status: outcome.status, artifactRef, artifact: outcome.artifact, ms: clock.now() - began };
			} else if (request.kind === "infer") {
				let prepend: AgentMessage[] = [];
				if (ports.projection) {
					const projected = await untilAborted(Promise.resolve(ports.projection.project({ view: current as RunView, step: request, stepId, signal })), signal);
					if (projected === ABORTED) {
						await send({ type: "step_end", kind: "infer", purpose: request.purpose, status: "aborted", artifactRef, ms: clock.now() - began }, { stepId });
						return await end("aborted", "aborted_during_projection");
					}
					prepend = projected ?? [];
				}
				const message = await engine.infer({
					stepId,
					purpose: request.purpose,
					prepend,
					signal,
					onAttempt: (attempt) => send({ type: "step_attempt", kind: "infer", attemptId: `${stepId}#a${attempt}`, attempt }, { stepId, origin: "model", visibility: "keeper" }),
				});
				const calls = message.content.filter((block): block is AgentToolCall => block.type === "toolCall");
				const failed = message.stopReason === "error" || message.stopReason === "aborted";
				// An errored or aborted response executes nothing; a truncated one is refused call by call.
				const proposals: OperationProposal[] = failed
					? []
					: calls.map((toolCall) => ({ origin: "model" as const, operation: toolCall.name, params: toolCall.arguments, toolCall, assistantMessage: message, executable: message.stopReason !== "length" }));
				if (proposals.length) {
					pendingProposals = proposals;
					openTurn = { message, results: [] };
				} else {
					const boundary = await engine.closeTurn(message, []);
					if (boundary.continueRequested) requirements.add("turn_boundary_continue");
				}
				const status: ObservationStatus = message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "unavailable" : "ok";
				observation = { id: artifactRef, stepId, producerStepId: stepId, sequence: steps, kind: "infer", purpose: request.purpose, origin: "model", status, artifactRef, message, proposals, ms: clock.now() - began, reason: request.reason };
				if (status === "aborted" || signal.aborted) {
					observations.push(observation);
					await send({ type: "step_end", kind: "infer", purpose: request.purpose, status: "aborted", artifactRef, ms: observation.ms }, { stepId, origin: "model", visibility: "keeper" });
					return await end("aborted", "aborted_during_infer");
				}
			} else if (request.kind === "operate") {
				const outcomes: OperationOutcome[] = [];
				const toolResults: ToolResultMessage[] = [];
				let aborted = false;
				for (const [index, proposal] of request.proposals.entries()) {
					const operationId = `${stepId}/op${index + 1}`;
					const meta = { stepId, origin: proposal.origin, visibility: (proposal.origin === "model" ? "keeper" : "internal") as StepVisibility };
					await send({ type: "operation_prepared", operationId, operation: proposal.operation, readOnly: proposal.readOnly === true, ...(proposal.label ? { label: proposal.label } : {}), ...(proposal.toolCall ? { toolCallId: proposal.toolCall.id } : {}) }, meta);
					let outcome: OperationOutcome | typeof ABORTED;
					if (aborted || signal.aborted) outcome = ABORTED;
					else if (proposal.origin === "model" && proposal.executable === false) {
						outcome = { status: "refused", reason: "output_limit", toolResult: await engine.refuseModelTool(proposal, `Tool call "${proposal.operation}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`) };
					} else {
						const invocation: OperationInvocation = {
							runId: input.runId, stepId, operationId, origin: proposal.origin, inputRevision: input.inputRevision, scopeId: scopeId(), signal,
							...(proposal.origin === "model" ? { executeModelTool: () => engine.executeModelTool(proposal, signal) } : {}),
						};
						const port = proposal.readOnly && proposal.operation === "read" ? ports.read : undefined;
						try {
							outcome = await untilAborted(
								port ? port.read(proposal, invocation)
									: ports.operations ? ports.operations.execute(proposal, invocation)
										: proposal.origin === "model" ? invocation.executeModelTool!().then((toolResult) => ({ status: "ok" as const, toolResult }))
											: Promise.resolve({ status: "unavailable" as const, reason: "no_operations_port" }),
								signal,
							);
						} catch (error) {
							outcome = { status: "unavailable", reason: String(error instanceof Error ? error.message : error) };
						}
					}
					if (outcome === ABORTED) {
						aborted = true;
						// A real model call is still answered, explicitly, so the transcript keeps call and result paired.
						const toolResult = proposal.origin === "model" && proposal.toolCall ? await engine.refuseModelTool(proposal, "Operation aborted: the run was cancelled before this call was executed.") : undefined;
						if (toolResult) toolResults.push(toolResult);
						await send({ type: "operation_settled", operationId, operation: proposal.operation, status: "aborted", ...(proposal.toolCall ? { toolCallId: proposal.toolCall.id } : {}) }, meta);
						continue;
					}
					if (proposal.origin === "model" && proposal.toolCall && outcome.toolResult?.toolCallId !== proposal.toolCall.id) {
						// A model proposal must end with its own result; a port that answered otherwise is refused explicitly.
						outcome = { ...outcome, status: "refused", reason: outcome.reason ?? "no_paired_result", toolResult: await engine.refuseModelTool(proposal, "The host did not execute this call.") };
					}
					if (outcome.toolResult) toolResults.push(outcome.toolResult);
					outcomes.push(outcome);
					await send({ type: "operation_settled", operationId, operation: proposal.operation, status: outcome.status, ...(proposal.toolCall ? { toolCallId: proposal.toolCall.id } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) }, meta);
					if (outcome.status === "ok" && outcome.delivery) {
						delivery = outcome.delivery;
						await send({ type: "delivery_accepted", delivery: outcome.delivery, operationId }, { ...meta, visibility: "player" });
					}
				}
				const modelCalls = new Set(request.proposals.filter((p) => p.origin === "model").map((p) => p.toolCall?.id));
				if (modelCalls.size) {
					pendingProposals = pendingProposals.filter((p) => !modelCalls.has(p.toolCall?.id));
					if (openTurn) {
						openTurn.results.push(...toolResults);
						if (!pendingProposals.length) {
							const turn = openTurn;
							openTurn = undefined;
							const boundary = await engine.closeTurn(turn.message, turn.results);
							if (boundary.continueRequested) requirements.add("turn_boundary_continue");
						}
					}
				}
				const status: ObservationStatus = aborted ? "aborted" : outcomes.some((o) => o.status === "ok") ? "ok" : (outcomes[0]?.status ?? "ok");
				observation = { id: artifactRef, stepId, producerStepId: stepId, sequence: steps, kind: "operate", origin, status, artifactRef, artifact: outcomes.map((o) => o.artifact), outcomes, toolResults, ...(delivery === "accepted" || delivery === "awaiting_player" ? { delivery } : {}), ms: clock.now() - began, ...(request.reason ? { reason: request.reason } : {}) };
				if (aborted) {
					observations.push(observation);
					await send({ type: "step_end", kind: "operate", status: "aborted", artifactRef, ms: observation.ms }, { stepId, origin });
					return await end("aborted", "aborted_during_operate");
				}
			} else if (request.kind === "scope") {
				const parentScopeId = scopeId();
				if (request.transition === "enter") {
					scopeStack = [...scopeStack, request.scopeId];
					await send({ type: "scope_enter", parentScopeId }, { stepId });
				} else {
					if (scopeStack.length < 2 || scopeId() !== request.scopeId) throw new PolicyViolation(`scope_exit of ${request.scopeId} is not the active frame`);
					await send({ type: "scope_exit", parentScopeId: scopeStack[scopeStack.length - 2] }, { stepId });
					scopeStack = scopeStack.slice(0, -1);
				}
				observation = { id: artifactRef, stepId, producerStepId: stepId, sequence: steps, kind: "scope", purpose: request.transition, origin: "policy", status: "ok", artifactRef, artifact: { scopeId: request.scopeId, transition: request.transition, spec: request.spec }, ms: clock.now() - began };
			} else {
				// wait: the condition is recorded and the run yields; nothing polls.
				observation = { id: artifactRef, stepId, producerStepId: stepId, sequence: steps, kind: "wait", origin: "policy", status: "ok", artifactRef, artifact: request.condition, ms: clock.now() - began };
				observations.push(observation);
				await send({ type: "step_end", kind: "wait", status: "ok", artifactRef, ms: observation.ms, ...(request.reason ? { reason: request.reason } : {}) }, { stepId });
				return await end("waiting", request.reason ?? "wait");
			}

			observations.push(observation);
			stateVersion++;
			await send(
				{ type: "step_end", kind: observation.kind, ...(observation.purpose ? { purpose: observation.purpose } : {}), status: observation.status, artifactRef, ms: observation.ms, ...(observation.reason ? { reason: observation.reason } : {}) },
				{ stepId, origin: observation.origin, visibility: observation.kind === "infer" ? "keeper" : "internal" },
			);
			policyState = policy.reduce(policyState, observation, view());
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return await end("failed", error instanceof PolicyViolation ? "policy_violation" : "driver_error", message);
	}

	/** The structural rules every policy obeys (the loop's own guards, not a domain's). */
	function validate(request: StepRequest, current: RunView<S>): void {
		if (current.pendingProposals.length) {
			if (request.kind === "operate" && sameProposals(request.proposals, current.pendingProposals)) return;
			if (request.kind === "finish" && (request.outcome === "aborted" || request.outcome === "failed")) return;
			throw new PolicyViolation(`model proposals are pending; ${request.kind} may not run before they are executed`);
		}
		if (request.kind === "operate") {
			if (!request.proposals.length) throw new PolicyViolation("operate without proposals");
			if (request.proposals.some((p) => p.origin === "model")) throw new PolicyViolation("model proposals exist only as the pending proposals of an infer");
		}
		// Guard: after a model step only execution or completion follows, never another judgment or request.
		const last = current.lastObservation;
		if (last?.kind === "infer" && (request.kind === "decide" || request.kind === "infer"))
			throw new PolicyViolation(`after an infer only operate or finish may follow, not ${request.kind}`);
	}
}
