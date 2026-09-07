/** The real setup table is also the transport fixture's table. */
import { readFileSync } from "node:fs";
export const SETUP_TABLE = JSON.parse(readFileSync(new URL("../../../content/setup/steps.json", import.meta.url), "utf8"));
export const SETUP_STEPS = SETUP_TABLE.steps;
