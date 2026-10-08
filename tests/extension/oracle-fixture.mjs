/**
 * Outcomes captured once from the implementation this kernel was ported from, kept as evidence.
 *
 * These suites used to run that implementation beside this one and compare the two. It cannot move
 * any more -- there is no Python left to pin a newer revision to -- so every capability and every
 * projection field added after the freeze read as a difference rather than as the change it was.
 * The cases and the outcome each case is owed are a file now: the coverage is the same, and a
 * change in what an input is owed has to be made deliberately, in a diff.
 *
 * Set `PI_COC_REFREEZE_ORACLE=1` to rewrite a fixture from `produce`, which is only meaningful
 * while a checkout still has the retired implementation available.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';

/**
 * The recovery metadata this kernel grew after the freeze: `retryable` and `next`, carried by every
 * error frame since "Make PipiCOC tool failures actionable". The retired implementation never wrote
 * them, so no captured outcome can contain them, and comparing a live frame against one reads two
 * deliberate fields as a difference -- which is how one commit left every error-frame case in six
 * suites red at once.
 *
 * They are dropped from the LIVE side only, and only off an error frame. The captured outcomes are
 * kept exactly as the reference printed them: they are evidence, and writing a field into them that
 * the reference never produced would make the evidence say something untrue. This is the same move
 * the scope-review divergence already makes in `ts-kernel-modules` -- keep every prior assertion on
 * the unchanged payload, and let the addition be asserted where it belongs. These two fields have
 * their own tests (`kernel-error-bridge`, `resolve`); what these suites compare is the ported
 * vocabulary, which the addition did not change.
 */
export const POST_FREEZE_ERROR_FIELDS = Object.freeze(["retryable", "next"]);
export function withoutPostFreezeRecovery(value) {
  if (Array.isArray(value)) return value.map(withoutPostFreezeRecovery);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
    if (key !== "error" || !inner || typeof inner !== "object" || Array.isArray(inner)) return [key, withoutPostFreezeRecovery(inner)];
    return [key, Object.fromEntries(Object.entries(inner).filter(([field]) => !POST_FREEZE_ERROR_FIELDS.includes(field)))];
  }));
}

/**
 * Contract §186.3 (2026-10-06): the draft check lists every finding of its stage in the refusal's `details.findings`
 * (and counts what the bound cut in `details.truncated`). Every capture of a draft-check refusal predates it, so a
 * byte-for-byte comparison reads the deliberate addition as a difference. As with `POST_FREEZE_ERROR_FIELDS`, the two
 * keys are dropped from the LIVE side only, and only off an error frame's `details`: the code, message, fix, path, reason
 * and rule each capture holds -- the first finding, as the check has always worded it -- are still compared byte for
 * byte. The list itself is asserted where it belongs, in `draft-check-findings.test.mjs`.
 */
export const DRAFT_FINDINGS_FIELDS = Object.freeze(["findings", "truncated"]);
export function withoutDraftFindings(value) {
  if (Array.isArray(value)) return value.map(withoutDraftFindings);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
    if (key !== "error" || !inner || typeof inner !== "object" || Array.isArray(inner) || !inner.details || typeof inner.details !== "object")
      return [key, withoutDraftFindings(inner)];
    return [key, {...inner, details: Object.fromEntries(Object.entries(inner.details).filter(([field]) => !DRAFT_FINDINGS_FIELDS.includes(field)))}];
  }));
}

/**
 * The authored identity of a place -- `destination_identity`, the name the module's book gives the
 * building a scene is and the other names it is known by -- projected onto the graph's entity view
 * after the freeze, so that the action-admission reviewer can tell that the scene handled
 * `newspaper-morgue` *is* the Boston Globe the player walked into. The retired implementation
 * stripped the projection record wholesale and never produced the field, so no captured outcome can
 * carry it, and comparing a live entity view against one reads a deliberate addition as a
 * difference.
 *
 * Dropped from the LIVE side only, and only off an entity view, exactly as `POST_FREEZE_ERROR_FIELDS`
 * is: the captured outcomes stay as the reference printed them, because they are evidence. The
 * addition is asserted where it belongs, in `destination-identity.test.mjs`, which reads it off the
 * real module on disk and follows it to the reviewer.
 *
 * The strip is deliberately shallow and applied to an entity view alone. The same key also lives,
 * authored, deep inside a raw node's `runtime_projection.record`, which `search` returns and the
 * captures hold exactly as the reference printed it: a strip that went looking for the key
 * everywhere would delete the module's own data from the live side and report the difference as
 * agreement.
 */
export const POST_FREEZE_ENTITY_FIELDS = Object.freeze(["destination_identity", "destination_access"]);
export function withoutPostFreezeIdentity(view) {
  if (!view || typeof view !== "object" || Array.isArray(view)) return view;
  return Object.fromEntries(Object.entries(view).filter(([key]) => !POST_FREEZE_ENTITY_FIELDS.includes(key)));
}

/**
 * Graph nodes authored after the freeze (contract §134.18: the haunting's commission, an accept obligation). The retired
 * reference never saw them, and a ranked, capped read such as `search` shifts its whole answer when one more node competes,
 * so a live graph that carries one reads a deliberate addition as a difference everywhere. The graph a comparison reads is
 * the shipped graph less these nodes and the claims and relations that name them (the freeze-time graph); the nodes are
 * asserted where they belong (`obligation-shape.test.mjs`, `tests/kernel/test_scene_obligations.py`).
 */
export const POST_FREEZE_NODES = Object.freeze(["requirement-knott-accept-commission",
  // Haunting graph v2 (2026-10-08): the house's floors and rooms.
  ...["basement-coal-bin", "basement-crawl-space", "basement-hiding-place", "basement-storage", "corbitt-house-basement",
    "corbitt-house-ground-floor", "corbitt-house-upper-floor", "ground-dining-room", "ground-kitchen", "ground-living-room",
    "ground-mud-room", "ground-second-storage-room", "ground-storage-room", "upper-bathroom", "upper-childrens-bedroom",
    "upper-main-bedroom", "upper-spare-bedroom"].map((place) => `location-${place}`)]);
/** Haunting graph v2: roads between scenes the reference already had, so no removed node names them. */
export const POST_FREEZE_LINKS = Object.freeze(["hall-of-records", "higher-courts-central-police", "neighborhood-gossip"]
  .map((scene) => `route-to-${scene}-chapel`));
export function withoutPostFreezeNodes(graph) {
  // Claims and relations name a node in their own id fields (graph.v3): never serialised here, since a graph's numbers are
  // Python floats that only the Python JSON writer keeps.
  const names = (value) => [value?.object?.node_id, value?.subject_id, value?.from_node_id, value?.to_node_id].some((id) => POST_FREEZE_NODES.includes(id));
  const later = (id) => POST_FREEZE_LINKS.some((link) => id === `claim-${link}` || id === `relation-${link}`);
  return {...graph, nodes: graph.nodes.filter((node) => !POST_FREEZE_NODES.includes(node.node_id)),
    claims: (graph.claims ?? []).filter((claim) => !names(claim) && !later(claim.claim_id)),
    relations: (graph.relations ?? []).filter((relation) => !names(relation) && !later(relation.relation_id))};
}

/**
 * Haunting graph v2 (2026-10-08) wrote what a newcomer sees into fields the reference read differently or not at all
 * (scene summaries, descriptions, biographies, the people's visibility, clue checks, the roads' scene edges). Each field
 * is put back to its freeze-time value, or removed where it did not exist (`fixtures/haunting-freeze-time-words.json`),
 * so the captures compare against the graph they answered; the new words are asserted in `haunting-graph-v2.test.mjs`.
 */
export function withFreezeTimeWords(graph, frozen) {
  const nodes = graph.nodes.map((node) => {
    const fields = frozen.nodes[node.node_id];
    if (!fields) return node;
    // Copied along each path only: a graph's numbers are Python float objects the Python JSON writer keeps, so the node is
    // never cloned whole.
    const restored = {...node};
    for (const [path, value] of Object.entries(fields)) {
      const keys = path.split("/"), last = keys.pop();
      let holder = restored;
      for (const key of keys) holder = holder[key] = {...holder[key]};
      if (value && value.$absent === true) delete holder[last];
      else holder[last] = value;
    }
    return restored;
  });
  return {...graph, nodes};
}

/**
 * The haunting's beings as the reference saw them (contract §180.12, CK-F). The starter carried its rat swarm twice, the
 * stat block and an invented person dossier on `npc-rat-pack` and the presence on `creature-rat-pack`; it now carries one
 * creature node with the book's numbers and habits, and Corbitt states his weaknesses. The reference answered the twin --
 * a people roster cut to a budget lists it -- so a comparison reads the freeze-time beings: the retired rows put back where
 * they stood (`frozen`, the parsed `fixtures/haunting-freeze-time-beings.json`, read with the caller's own JSON reader so
 * its numbers stay what the starter shipped), the npc listed again in its projection document, and the properties the
 * creature and Corbitt gained after the freeze set aside. The new data is asserted where it belongs
 * (`starter-creatures.test.mjs`, `haunting-shapes.test.mjs`).
 */
export function withFreezeTimeBeings(graph, frozen) {
  const restored = {...graph};
  for (const [collection, key] of [["nodes", "node_id"], ["claims", "claim_id"], ["relations", "relation_id"]]) {
    const {before, value} = frozen.insert[collection], rows = [...restored[collection]];
    const at = rows.findIndex((entry) => entry[key] === before);
    if (at < 0 || rows.some((entry) => entry[key] === value[key])) throw new Error(`the freeze-time ${collection} row ${value[key]} cannot be put back before ${before}`);
    rows.splice(at, 0, value);
    restored[collection] = rows;
  }
  const twin = frozen.insert.nodes.value.node_id;
  restored.nodes = restored.nodes.map((node) => {
    if (node.node_id === "creature-rat-pack")
      return {...node, evidence_span_ids: [], properties: {runtime_rule_ref: node.properties.runtime_rule_ref},
        source_refs: node.source_refs.map(({grep_anchor: _anchor, ...ref}) => ref)};
    if (node.node_id === "npc-walter-corbitt") {
      const {weaknesses: _weaknesses, ...properties} = node.properties;
      return {...node, properties};
    }
    if (node.node_kind === "module")
      return {...node, properties: {...node.properties, runtime_projection: {...node.properties.runtime_projection,
        documents: node.properties.runtime_projection.documents.map((document) => document.filename !== "npc-agendas.json" ? document
          : {...document, collections: document.collections.map((entry) => ({...entry, node_ids: [...entry.node_ids, twin]}))})}}};
    return node;
  });
  return restored;
}

const FIXTURES = resolve(import.meta.dirname, 'fixtures/oracle');
const digestOf = source => createHash('sha256').update(source).digest('hex').slice(0, 16);
/**
 * A capture answers one question put to one reference program, but keys are built from the question
 * alone. Edit the program and every key it ever wrote still points at text the edit was meant to
 * change, so the suite goes on comparing against the answer to a question it no longer asks -- the
 * catalogue digests were served that way for a whole branch. Each suite records which program its
 * captures came from, beside them, and stale ones fail instead of answering.
 *
 * One file per suite, named for the prefix every one of its keys carries, so the process that runs
 * a suite is the only writer of that suite's record even when the runner runs the files at once.
 */
const sourcesPath = key => join(FIXTURES, key.split('-')[0] + '.sources.json');
const readSources = key => {
  try { return JSON.parse(readFileSync(sourcesPath(key), 'utf8')); } catch { return {}; }
};

/**
 * The captured outcome as the text it was printed as, so each suite parses it with the same reader
 * it parses a live answer with. A number too large for a double survives as itself that way.
 *
 * `source` is the reference program `produce` runs. Pass it, and a capture taken from a different
 * program fails rather than answering.
 */
export function expected(key, produce, source) {
  const path = join(FIXTURES, key + '.json');
  if (!process.env.PI_COC_REFREEZE_ORACLE) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Missing captured outcome ${key}; regenerate with PI_COC_REFREEZE_ORACLE=1`, {cause: error});
    }
    if (source !== undefined) {
      const recorded = readSources(key)[key];
      if (recorded !== digestOf(source))
        throw new Error(`Captured outcome ${key} came from a different reference program (recorded ${recorded ?? 'nothing'}, now ${digestOf(source)}); regenerate with PI_COC_REFREEZE_ORACLE=1`);
    }
    return text;
  }
  const text = produce();
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n');
  if (source !== undefined) {
    const sources = {...readSources(key), [key]: digestOf(source)};
    const ordered = Object.fromEntries(Object.keys(sources).sort().map(name => [name, sources[name]]));
    writeFileSync(sourcesPath(key), JSON.stringify(ordered, null, 2) + '\n');
  }
  return text;
}
