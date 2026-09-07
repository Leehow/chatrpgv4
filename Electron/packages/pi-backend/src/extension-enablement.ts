import { satisfiesExtensionHostApiRange } from "./extension-update-engine.js";
import type { ExtensionUiLayout } from "./extension-manifest.js";

/**
 * Additive extension enablement.
 *
 * There is no whitelist. A package is on because it says it is on
 * (`defaultEnabled`, the discovery default for bundled and project-installed
 * packages) or because an enabled package requires it — and off only when an
 * explicit user toggle says off. Explicit toggles outrank both, project scope
 * outranking App scope.
 *
 * A **product pack** is an ordinary extension that declares
 * `dependencies.required` (the capability set its form needs) plus
 * `app.ui.layout` (the shell that form presents). Enabling one enables its
 * required closure; disabling it releases whatever nothing else still requires
 * and the user never enabled explicitly, because this resolution is recomputed
 * from scratch rather than bookkept.
 */

export type EnablementRequirement = {
  id: string;
  version: string;
};

export type EnablementDependencies = {
  required?: readonly EnablementRequirement[];
  optional?: readonly EnablementRequirement[];
  conflicts?: readonly string[];
};

/** One installed package as the enable closure sees it. */
export type InstalledExtension = {
  id: string;
  version: string;
  /** Discovery default before any explicit toggle. */
  defaultEnabled: boolean;
  /** Declared only by a product pack; its presence is what makes this a form. */
  layout?: ExtensionUiLayout;
  dependencies?: EnablementDependencies;
};

export type ExtensionEnableReason =
  /** The manifest's own `defaultEnabled`. */
  | "default"
  /** Pulled in by an enabled package's `dependencies.required`. */
  | "dependency"
  /** The user's own App- or project-scope toggle. */
  | "explicit"
  /** The product's `defaultPack`, absent an explicit toggle. */
  | "default-pack";

export type EnablementIssue =
  | { code: "missing"; id: string; range: string; requiredBy: string }
  | { code: "version_mismatch"; id: string; range: string; installedVersion: string; requiredBy: string }
  | { code: "required_disabled"; id: string; requiredBy: string }
  | { code: "conflict"; id: string; conflictsWith: string };

export type ExtensionEnablement = {
  /** Every installed id → effective state. Also the spawn/list overlay. */
  enabled: Record<string, boolean>;
  enabledIds: string[];
  reasons: Record<string, ExtensionEnableReason>;
  /**
   * Enabled packages declaring a layout, most authoritative first: a pack the
   * user turned on explicitly outranks one that is merely on by default, and
   * ties break on id so the choice never depends on scan order.
   */
  packIds: string[];
  issues: EnablementIssue[];
};

export type ResolveEnablementInput = {
  installed: readonly InstalledExtension[];
  /** Explicit App-scope toggles (App profile settings `extensions` slot). */
  appOverrides?: Readonly<Record<string, boolean>>;
  /** Explicit project-scope toggles (`{project}/.pi/agent/ext-enabled.json`). */
  projectOverrides?: Readonly<Record<string, boolean>>;
  /** The product's default form (`product.json` `defaultPack`); an explicit toggle still wins. */
  defaultPackId?: string;
};

function issueKey(issue: EnablementIssue): string {
  return JSON.stringify(issue);
}

export function resolveExtensionEnablement(input: ResolveEnablementInput): ExtensionEnablement {
  const installed = [...input.installed].sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map(installed.map(item => [item.id, item]));
  const explicit: Record<string, boolean> = { ...input.appOverrides, ...input.projectOverrides };
  const issues: EnablementIssue[] = [];
  const seen = new Set<string>();
  const pushIssue = (issue: EnablementIssue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  const enabled = new Set<string>();
  const reasons: Record<string, ExtensionEnableReason> = {};
  const queue: string[] = [];
  for (const item of installed) {
    const override = Object.prototype.hasOwnProperty.call(explicit, item.id) ? explicit[item.id] : undefined;
    const on = override ?? (item.id === input.defaultPackId ? true : item.defaultEnabled);
    if (!on) continue;
    enabled.add(item.id);
    reasons[item.id] = override !== undefined
      ? "explicit"
      : item.id === input.defaultPackId && !item.defaultEnabled
        ? "default-pack"
        : "default";
    queue.push(item.id);
  }

  // Transitive required closure. The visited set doubles as cycle protection:
  // a package already enabled is never queued twice.
  while (queue.length) {
    const current = byId.get(queue.shift()!);
    if (!current) continue;
    for (const requirement of [...(current.dependencies?.required ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      const candidate = byId.get(requirement.id);
      if (!candidate) {
        pushIssue({ code: "missing", id: requirement.id, range: requirement.version, requiredBy: current.id });
        continue;
      }
      if (!satisfiesExtensionHostApiRange(requirement.version, candidate.version)) {
        pushIssue({
          code: "version_mismatch",
          id: requirement.id,
          range: requirement.version,
          installedVersion: candidate.version,
          requiredBy: current.id,
        });
        continue;
      }
      if (explicit[requirement.id] === false) {
        // The user's own decision outranks the dependent package's wish. The
        // dependent stays on (an additive model never fails closed); the gap is
        // reported so the host can warn instead of silently half-working.
        pushIssue({ code: "required_disabled", id: requirement.id, requiredBy: current.id });
        continue;
      }
      if (enabled.has(candidate.id)) continue;
      enabled.add(candidate.id);
      reasons[candidate.id] = "dependency";
      queue.push(candidate.id);
    }
  }

  const enabledIds = [...enabled].sort();
  for (const id of enabledIds) {
    const item = byId.get(id);
    for (const other of [...(item?.dependencies?.conflicts ?? [])].sort()) {
      if (!enabled.has(other)) continue;
      pushIssue({ code: "conflict", id, conflictsWith: other });
    }
  }

  const packIds = enabledIds
    .filter(id => byId.get(id)?.layout)
    .sort((left, right) => {
      const leftExplicit = reasons[left] === "explicit" ? 0 : 1;
      const rightExplicit = reasons[right] === "explicit" ? 0 : 1;
      return leftExplicit - rightExplicit || left.localeCompare(right);
    });

  return {
    enabled: Object.fromEntries(installed.map(item => [item.id, enabled.has(item.id)])),
    enabledIds,
    reasons,
    packIds,
    issues,
  };
}

/** Layout of the active form, or `undefined` when the project is plain base. */
export function activePackLayout(
  enablement: ExtensionEnablement,
  installed: readonly InstalledExtension[],
): { id: string; layout: ExtensionUiLayout } | undefined {
  const id = enablement.packIds[0];
  if (!id) return undefined;
  const layout = installed.find(item => item.id === id)?.layout;
  return layout ? { id, layout } : undefined;
}

export function formatEnablementIssue(issue: EnablementIssue): string {
  switch (issue.code) {
    case "missing":
      return `${issue.requiredBy} requires ${issue.id} ${issue.range}, which is not installed`;
    case "version_mismatch":
      return `${issue.requiredBy} requires ${issue.id} ${issue.range}, but ${issue.installedVersion} is installed`;
    case "required_disabled":
      return `${issue.requiredBy} requires ${issue.id}, which you disabled explicitly`;
    case "conflict":
      return `${issue.id} conflicts with ${issue.conflictsWith}`;
  }
}

export function formatEnablementIssues(issues: readonly EnablementIssue[]): string {
  return issues.map(formatEnablementIssue).join("; ");
}

/**
 * Issues one toggle would introduce that a hard refusal owes the user: a pack
 * that cannot assemble (a required package missing or version-mismatched) and a
 * pack that collides with something already on. An explicitly disabled
 * dependency is deliberately not a blocker — that state is the user's own
 * choice, reported as a warning rather than used to veto their next one.
 */
export function enablementBlockers(
  before: ExtensionEnablement,
  after: ExtensionEnablement,
): EnablementIssue[] {
  const known = new Set(before.issues.map(issueKey));
  return after.issues.filter(issue => issue.code !== "required_disabled" && !known.has(issueKey(issue)));
}
