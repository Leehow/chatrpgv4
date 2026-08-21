import test from "node:test";
import assert from "node:assert/strict";

import { isWaitingPdfFile } from "./waiting-pdf-import.ts";

test("accepts application/pdf", () => {
  assert.equal(
    isWaitingPdfFile({ name: "mod.bin", type: "application/pdf" }),
    true,
  );
});

test("accepts .pdf suffix without MIME", () => {
  assert.equal(isWaitingPdfFile({ name: "模组.PDF", type: "" }), true);
});

test("rejects other files", () => {
  assert.equal(
    isWaitingPdfFile({ name: "notes.txt", type: "text/plain" }),
    false,
  );
});
