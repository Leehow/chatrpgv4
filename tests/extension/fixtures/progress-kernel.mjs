#!/usr/bin/env node
/**
 * Scripted kernel for the progress-frame tests (contract §1): for every request it first
 * emits one progress frame per stage in PROGRESS_KERNEL_STAGES, then the final ok frame.
 * It sends the frames whether or not the request opted in, so one fixture covers both the
 * opted-in path and the unsolicited-frame path. Every request line is appended to
 * PROGRESS_KERNEL_LOG as JSON so the test can check the wire shape.
 */

import { appendFileSync } from "node:fs";

const LOG = process.env.PROGRESS_KERNEL_LOG;
const STAGES = process.env.PROGRESS_KERNEL_STAGES ? JSON.parse(process.env.PROGRESS_KERNEL_STAGES) : [];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (line.trim()) answer(JSON.parse(line));
		index = buffer.indexOf("\n");
	}
});

function answer(request) {
	if (LOG) appendFileSync(LOG, `${JSON.stringify(request)}\n`);
	for (const stage of STAGES) {
		process.stdout.write(`${JSON.stringify({ id: request.id, progress: { stage, at: new Date().toISOString() } })}\n`);
	}
	process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result: { method: request.method } })}\n`);
}
