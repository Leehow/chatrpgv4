#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const CANONICAL_CAMPAIGN_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isCanonicalCampaignId(value) {
  return (
    typeof value === "string"
    && CANONICAL_CAMPAIGN_ID_PATTERN.test(value)
  );
}

function fail() {
  process.stderr.write(
    "pi-coc: campaign_id must match "
    + "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\n",
  );
  process.exit(2);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const values = process.argv.slice(2);
  if (values.length !== 1 || !isCanonicalCampaignId(values[0])) {
    fail();
  }
}
