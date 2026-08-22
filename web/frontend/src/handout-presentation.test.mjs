import test from "node:test";
import assert from "node:assert/strict";

import {
  appendHandoutPresentation,
  dedupeHandoutMaterials,
} from "./handout-presentation.ts";

test("same material may appear twice only with distinct presentation identities", () => {
  const first = {
    asset_id: "map-1",
    presentation_id: "map-1:presentation:1",
    presentation_revision: 1,
  };
  const replay = {
    ...first,
    presentation_id: "map-1:presentation:2",
    presentation_revision: 2,
  };
  let messages = appendHandoutPresentation([], first, 10);
  messages = appendHandoutPresentation(messages, first, 11);
  messages = appendHandoutPresentation(messages, replay, 12);
  assert.deepEqual(messages.map((message) => message.card.presentation_id), [
    "map-1:presentation:1",
    "map-1:presentation:2",
  ]);
});

test("materials remain deduped by stable asset identity", () => {
  assert.deepEqual(
    dedupeHandoutMaterials([
      { asset_id: "map-1", title: "Map" },
      { asset_id: "map-1", title: "Map replay" },
      { asset_id: "letter-1", title: "Letter" },
    ]).map((card) => card.asset_id),
    ["map-1", "letter-1"],
  );
});
