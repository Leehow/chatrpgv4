import test from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_LEFT_BOUNDS,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_RIGHT_BOUNDS,
  clampWidth,
  dragToWidth,
  hasLocalLayoutKeys,
  readStoredCollapsed,
  readStoredWidth,
  renderedSidebarWidth,
  resolveHydratedCollapsed,
  resolveHydratedWidth,
  responsiveSidebarClasses,
  shouldUploadLayoutFallback,
  writeStoredCollapsed,
  writeStoredWidth,
} from "./sidebar-layout.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("clampWidth rounds then clamps", () => {
  assert.equal(clampWidth(10.4, 0, 100), 10);
  assert.equal(clampWidth(10.6, 0, 100), 11);
  assert.equal(clampWidth(-4, 0, 100), 0);
  assert.equal(clampWidth(999, 0, 100), 100);
});

test("readStoredWidth reads, clamps, and falls back", () => {
  const storage = memoryStorage({ w: "300" });
  assert.equal(readStoredWidth(storage, "w", 256, 180, 480), 300);
  storage.setItem("w", "9999");
  assert.equal(readStoredWidth(storage, "w", 256, 180, 480), 480);
  assert.equal(readStoredWidth(storage, "missing", 256, 180, 480), 256);
  storage.setItem("w", "not-a-number");
  assert.equal(readStoredWidth(storage, "w", 256, 180, 480), 256);
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readStoredWidth(throwing, "w", 256, 180, 480), 256);
});

test("collapsed and width persist through storage", () => {
  const storage = memoryStorage();
  writeStoredCollapsed(storage, "c", true);
  assert.equal(readStoredCollapsed(storage, "c", false), true);
  writeStoredCollapsed(storage, "c", false);
  assert.equal(readStoredCollapsed(storage, "c", true), false);
  assert.equal(readStoredCollapsed(storage, "missing", true), true);
  writeStoredWidth(storage, "w", 333);
  assert.equal(readStoredWidth(storage, "w", 256, 180, 480), 333);
});

test("dragToWidth grows left with +delta and right with -delta", () => {
  assert.equal(dragToWidth("left", 200, 40, 100, 500), 240);
  assert.equal(dragToWidth("right", 200, -40, 100, 500), 240);
  assert.equal(dragToWidth("left", 200, 999, 100, 250), 250);
  assert.equal(dragToWidth("right", 200, 999, 100, 250), 100);
});

test("empty session keeps left column inline from md and right from xl", () => {
  const classes = responsiveSidebarClasses(false);
  assert.equal(classes.leftColumn, "hidden md:block");
  assert.equal(classes.rightColumn, "hidden xl:block");
  assert.equal(classes.leftSheetTrigger, "md:hidden");
  assert.equal(classes.rightSheetTrigger, "xl:hidden");
});

test("session with content keeps right column inline from md and left from xl", () => {
  const classes = responsiveSidebarClasses(true);
  assert.equal(classes.leftColumn, "hidden xl:block");
  assert.equal(classes.rightColumn, "hidden md:block");
  assert.equal(classes.leftSheetTrigger, "xl:hidden");
  assert.equal(classes.rightSheetTrigger, "md:hidden");
});

test("hydrate width prefers remote then LS then default", () => {
  const { defaultWidth, minWidth, maxWidth } = SIDEBAR_LEFT_BOUNDS;
  assert.equal(
    resolveHydratedWidth({ remote: 400, storedRaw: "220", fallback: defaultWidth, min: minWidth, max: maxWidth }),
    400,
  );
  assert.equal(
    resolveHydratedWidth({ remote: null, storedRaw: "220", fallback: defaultWidth, min: minWidth, max: maxWidth }),
    220,
  );
  assert.equal(
    resolveHydratedWidth({ remote: undefined, storedRaw: null, fallback: defaultWidth, min: minWidth, max: maxWidth }),
    256,
  );
  assert.equal(
    resolveHydratedWidth({ remote: 12, storedRaw: "400", fallback: defaultWidth, min: minWidth, max: maxWidth }),
    minWidth,
  );
});

test("hydrate collapsed prefers remote boolean over LS", () => {
  assert.equal(resolveHydratedCollapsed({ remote: true, storedRaw: "0", fallback: false }), true);
  assert.equal(resolveHydratedCollapsed({ remote: undefined, storedRaw: "1", fallback: false }), true);
  assert.equal(resolveHydratedCollapsed({ remote: null, storedRaw: null, fallback: false }), false);
});

test("layout fallback upload only after remote load, once, when server has no layout", () => {
  assert.equal(
    shouldUploadLayoutFallback({
      remoteLoaded: false,
      remoteHasLayout: false,
      hasLocalLayout: true,
      alreadyUploaded: false,
    }),
    false,
  );
  assert.equal(
    shouldUploadLayoutFallback({
      remoteLoaded: true,
      remoteHasLayout: true,
      hasLocalLayout: true,
      alreadyUploaded: false,
    }),
    false,
  );
  assert.equal(
    shouldUploadLayoutFallback({
      remoteLoaded: true,
      remoteHasLayout: false,
      hasLocalLayout: false,
      alreadyUploaded: false,
    }),
    false,
  );
  assert.equal(
    shouldUploadLayoutFallback({
      remoteLoaded: true,
      remoteHasLayout: false,
      hasLocalLayout: true,
      alreadyUploaded: false,
    }),
    true,
  );
  assert.equal(
    shouldUploadLayoutFallback({
      remoteLoaded: true,
      remoteHasLayout: false,
      hasLocalLayout: true,
      alreadyUploaded: true,
    }),
    false,
  );
});

test("hasLocalLayoutKeys and rail rendered width", () => {
  const storage = memoryStorage({ "coc-web.sidebar.left.width": "256" });
  assert.equal(hasLocalLayoutKeys(storage, "coc-web.sidebar.left.width", "coc-web.sidebar.left.collapsed"), true);
  assert.equal(hasLocalLayoutKeys(memoryStorage(), "a", "b"), false);
  assert.equal(renderedSidebarWidth(true, 320), SIDEBAR_RAIL_WIDTH);
  assert.equal(renderedSidebarWidth(false, 320), 320);
  assert.equal(SIDEBAR_RIGHT_BOUNDS.defaultWidth, 320);
  assert.equal(SIDEBAR_RIGHT_BOUNDS.minWidth, 256);
  assert.equal(SIDEBAR_RIGHT_BOUNDS.maxWidth, 560);
});
