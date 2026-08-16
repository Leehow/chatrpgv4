import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWizardWindowOptions, existingWizardNeedsRebuild } from "./wizard-window-options.mjs";

const fakeParent = {};

describe("buildWizardWindowOptions", () => {
  it("sheet mode binds the parent and never goes native-modal", () => {
    const opts = buildWizardWindowOptions({ asSheet: true, parent: fakeParent });
    assert.equal(opts.parent, fakeParent);
    assert.notEqual(opts.modal, true);
    assert.equal(opts.loadQuery.mode, "sheet");
  });

  it("edit flag lands in the sheet query only (pencil-button direct open)", () => {
    const edited = buildWizardWindowOptions({ asSheet: true, parent: fakeParent, edit: true });
    assert.equal(edited.loadQuery.edit, "1");
    const plain = buildWizardWindowOptions({ asSheet: true, parent: fakeParent });
    assert.equal(plain.loadQuery.edit, undefined);
    const onboard = buildWizardWindowOptions({ edit: true });
    assert.equal(onboard.loadQuery.edit, undefined);
  });

  it("standalone mode has no parent and loads onboard mode", () => {
    const opts = buildWizardWindowOptions({ asSheet: false, parent: fakeParent });
    assert.equal(opts.parent, undefined);
    assert.equal(opts.loadQuery.mode, "onboard");
  });

  it("darwin standalone may hide the title bar; sheet mode keeps it (close button)", () => {
    const standalone = buildWizardWindowOptions({ platform: "darwin" });
    assert.equal(standalone.titleBarStyle, "hiddenInset");
    const sheet = buildWizardWindowOptions({ asSheet: true, parent: fakeParent, platform: "darwin" });
    assert.notEqual(sheet.titleBarStyle, "hiddenInset");
  });
});

describe("existingWizardNeedsRebuild", () => {
  const parented = { isDestroyed: () => false, getParentWindow: () => fakeParent };
  const orphan = { isDestroyed: () => false, getParentWindow: () => null };

  it("reuses a parented window for sheet mode", () => {
    assert.equal(existingWizardNeedsRebuild(parented, { asSheet: true, parent: fakeParent }), false);
  });

  it("rebuilds when parent binding mismatches or the window is gone", () => {
    assert.equal(existingWizardNeedsRebuild(orphan, { asSheet: true, parent: fakeParent }), true);
    assert.equal(existingWizardNeedsRebuild(parented, { asSheet: false, parent: fakeParent }), true);
    assert.equal(existingWizardNeedsRebuild(null, { asSheet: true, parent: fakeParent }), true);
  });
});
