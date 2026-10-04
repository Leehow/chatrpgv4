import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";
import { STEP_READS } from "../kernel/first-step-thinking.ts";

const DELIVERY_TOOLS = new Set(["narrate", "ask"]);
const FOLLOW_UP_LEVEL: ThinkingLevel = "off";

/**
 * Keep the table's chosen thinking level until the Keeper's first writing tool batch, then ask Pi
 * for the lowest supported level. A batch of reads only (contract §175.1) buys no lower level: the
 * step after it is usually the one that writes the epithets, the moods and the prose (§175). Pi owns
 * capability clamping: requesting `off` becomes `minimal` or `low` when a model's catalog exposes no
 * true off level.
 */
export default function thinkingSchedule(pi: ExtensionAPI): void {
	if (cocMode() !== "play") return;

	let tableLevel: ThinkingLevel | undefined;
	let scheduledLevel: ThinkingLevel | undefined;
	let scheduleAttempted = false;

	const restoreTableLevel = (): void => {
		if (tableLevel !== undefined && scheduledLevel !== undefined && pi.getThinkingLevel() === scheduledLevel) {
			pi.setThinkingLevel(tableLevel);
		}
		tableLevel = undefined;
		scheduledLevel = undefined;
		scheduleAttempted = false;
	};

	pi.on("before_agent_start", () => {
		// Defensive recovery for a host that starts another prompt without settling the previous one.
		restoreTableLevel();
		tableLevel = pi.getThinkingLevel();
	});

	// `turn_end` sees the complete assistant tool batch after every result (including blocked,
	// invalid, truncated, and aborted calls) and still runs before the next `prepareNextTurn`.
	pi.on("turn_end", (event) => {
		if (scheduleAttempted) return;
		const toolNames = event.message.content
			.filter((block) => block.type === "toolCall")
			.map((block) => block.name);
		if (toolNames.length === 0 || toolNames.some((name) => DELIVERY_TOOLS.has(name))) return;
		if (toolNames.every((name) => STEP_READS.has(name))) return;

		const current = pi.getThinkingLevel();
		// Respect an explicit level change made while the first tool batch was running.
		if (tableLevel !== current) tableLevel = current;
		if (current === "off") return;

		scheduleAttempted = true;
		pi.setThinkingLevel(FOLLOW_UP_LEVEL);
		const effective = pi.getThinkingLevel();
		if (effective !== current) scheduledLevel = effective;
	});

	pi.on("agent_settled", restoreTableLevel);
	pi.on("session_shutdown", restoreTableLevel);
}
