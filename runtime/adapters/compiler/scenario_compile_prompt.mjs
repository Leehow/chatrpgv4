/** Pure prompt construction for scenario compilation and bounded base revision. */
export function buildPrompt(request) {
  const safe = {
    module_identity: request.module_identity,
    source: request.source,
    required_files: request.required_files,
    compile_contract: request.compile_contract,
    pages: request.pages,
  };
  if (request.source_resolution_request) {
    safe.source_resolution_request = request.source_resolution_request;
    safe.previous_scenario_bundle = request.previous_scenario_bundle;
  }
  if (request.revision_attempt) {
    for (const key of [
      "revision_attempt", "parent_attempt", "parent_bundle_sha256", "best_attempt",
      "validation_feedback", "validation_findings", "regression_findings",
      "reference_snapshot", "regression_reference_snapshot", "revision_lineage",
      "previous_scenario_bundle",
    ]) {
      if (key in request) safe[key] = request[key];
    }
  }
  return [
    request.revision_attempt
      ? (
        "Revise exactly the supplied previous_scenario_bundle (the best validated parent so far) " +
        "to fix every structured validation finding. Preserve every valid object, ID, source-derived " +
        "field, and relationship not named by a finding; do not rewrite or delete unrelated content. " +
        "Treat code, severity, path, details, hashes, snapshots, and regression findings as authoritative. " +
        "Before submitting, self-check the complete set of story-graph available_clues entries against " +
        "the complete set of clue-graph clue_id definitions exactly: every reference must resolve and " +
        "every clue_id must be globally unique. If an ID is intentionally renamed, update every exact " +
        "structured reference. Do not add placeholders, silently drop references, or reconstruct prose."
      )
      : "Compile this Keeper-only source bundle into the exact requested scenario IR.",
    "Do not include markdown fences. Submit JSON through the tool.",
    JSON.stringify(safe, null, 2),
  ].join("\n\n");
}
