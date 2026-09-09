/**
 * Progress frames (contract §1): a call that opted in with top-level "progress": true may
 * receive stage frames before its final response. This module turns one frame into the
 * partial tool result the Pi runtime shows on the tool status line.
 */

import type { KernelProgressFrame } from "./client.ts";

/**
 * Closed table for the narrate pipeline stages (contract §5). A stage not listed here is
 * passed through by name: the enumeration is per-method and the extension does not gate it.
 */
const STAGE_TEXT: Record<string, string> = {
	load: "Loading campaign state",
	validate: "Validating turn",
	project: "Projecting mechanics",
	write: "Writing turn record",
	commit: "Committing turn",
	poststep: "Writing checkpoint",
};

/** One frame → one partial result: a short English line, plus the raw stage for UI details. */
export function progressPartial(frame: KernelProgressFrame): {
	content: Array<{ type: "text"; text: string }>;
	details: { stage: string };
} {
	return {
		content: [{ type: "text", text: STAGE_TEXT[frame.stage] ?? frame.stage }],
		details: { stage: frame.stage },
	};
}
