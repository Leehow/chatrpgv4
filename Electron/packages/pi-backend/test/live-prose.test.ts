import { describe, expect, it } from "vitest";

import { DELIVERY_PROSE_FIELDS, displayedProse, finishedProseField, LiveDeliveryProse, streamingStringField } from "../src/live-prose.js";

it('holds a carried argument label until real prose arrives and never draws a label-only placeholder',()=>{
  const live=new LiveDeliveryProse('transport');live.startTurn();live.start(0,'apply');
  expect(live.update(0,'{"narrate":"tex')).toBeUndefined();
  expect(live.update(0,'{"narrate":"text"}')).toBeUndefined();
  expect(live.end(0,{narrate:'text'})).toBeUndefined();
  live.start(1,'apply');expect(live.update(1,'{"narrate":"text|The clerk agrees.')).toMatchObject({text:'The clerk agrees.'});
  expect(live.end(1,{narrate:'text|The clerk agrees.'})).toBeUndefined();
  live.startTurn();live.start(0,'narrate');expect(live.end(0,{text:'text'})).toMatchObject({text:'text'});
});

/** Contract §171: the delivery read out of arguments still arriving, and what the screen holds as they do. */

describe("the prose field read out of streaming JSON (§171.1)", () => {
  it("grows with the text received and says when the string closed", () => {
    const json = JSON.stringify({ text: "The door gives." });
    expect(streamingStringField("", "text")).toBeUndefined();
    expect(streamingStringField("{\"te", "text")).toBeUndefined();
    expect(streamingStringField("{\"text\":", "text")).toBeUndefined();
    expect(streamingStringField("{\"text\":\"The do", "text")).toEqual({ value: "The do", complete: false });
    expect(streamingStringField(json, "text")).toEqual({ value: "The door gives.", complete: true });
    for (let cut = 0; cut <= json.length; cut += 1) {
      const found = streamingStringField(json.slice(0, cut), "text");
      if (found) expect("The door gives.".startsWith(found.value)).toBe(true);
    }
  });

  it("steps over the fields before it, whatever they hold", () => {
    const args = { effects: [{ kind: "person", who: "book-4-lars", name: "the {oily} \"rag\" owner", why: "first sight" }, { kind: "npc", mood: ["}", "]"] }],
      narrate: "你把车停在油泵旁。" };
    const json = JSON.stringify(args);
    expect(streamingStringField(json, "narrate")).toEqual({ value: "你把车停在油泵旁。", complete: true });
    // Still inside `effects`: nothing to show yet, and nothing from inside it is mistaken for the field.
    expect(streamingStringField(json.slice(0, json.indexOf("narrate") - 3), "narrate")).toBeUndefined();
    expect(streamingStringField(JSON.stringify({ effects: [{ narrate: "nested" }] }), "narrate")).toBeUndefined();
  });

  it("decodes escapes and holds back a half-received one, never half a character", () => {
    const value = "Line one.\n“引号” \\ tab\tand 🌙 moon";
    const json = JSON.stringify({ text: value });
    expect(streamingStringField(json, "text")?.value).toBe(value);
    for (let cut = 0; cut <= json.length; cut += 1) {
      const found = streamingStringField(json.slice(0, cut), "text");
      if (!found) continue;
      expect(value.startsWith(found.value)).toBe(true);
      expect(/[\ud800-\udbff]$/.test(found.value)).toBe(false);
    }
    expect(streamingStringField("{\"text\":\"a\\ud83c\\udf19b\"}", "text")?.value).toBe("a🌙b");
    expect(streamingStringField("{\"text\":\"a\\ud83c", "text")?.value).toBe("a");
  });

  it("finds nothing in a value that is not a string, or a text that is not an object", () => {
    expect(streamingStringField("{\"text\":42}", "text")).toBeUndefined();
    expect(streamingStringField("[\"text\"]", "text")).toBeUndefined();
    expect(streamingStringField("not json", "text")).toBeUndefined();
  });

  it("reads the finished arguments, parsed or not, and an apply.narrate written as an object", () => {
    expect(finishedProseField({ text: "Done." }, "text")).toBe("Done.");
    expect(finishedProseField("{\"text\":\"Done.\"}", "text")).toBe("Done.");
    expect(finishedProseField({ effects: [], narrate: { text: "As object." } }, "narrate")).toBe("As object.");
    expect(finishedProseField({ effects: [] }, "narrate")).toBeUndefined();
  });

  it("names the three delivering calls and the field each carries", () => {
    expect(DELIVERY_PROSE_FIELDS).toEqual({ narrate: "text", ask: "text", apply: "narrate" });
  });
});

describe("the prose as the player reads it (§171.1)", () => {
  it("drops the kernel's tokens by their braces and holds back one still being written", () => {
    expect(displayedProse("He looks up. {{say:the oily-rag owner}}“Fill it?”{{/say}} {{roll:spot-hidden}}"))
      .toBe("He looks up. “Fill it?”");
    expect(displayedProse("He looks up. {{say:the oily")).toBe("He looks up.");
    expect(displayedProse("He looks up. {")).toBe("He looks up.");
    expect(displayedProse("He looks up. {{say:x}")).toBe("He looks up.");
    expect(displayedProse("第一段。\n\n第二段。")).toBe("第一段。\n\n第二段。");
  });
});

describe("what the screen holds through a turn (§171.2)", () => {
  const json = (text: string) => JSON.stringify({ text });

  it("draws the first delivery as it streams, once with first, and settles it at its end", () => {
    const prose = new LiveDeliveryProse("draft");
    prose.start(0, "narrate");
    expect(prose.update(0, "{\"text\":\"")).toBeUndefined();
    expect(prose.update(0, "{\"text\":\"The lamp")).toEqual({ id: "draft:1", text: "The lamp", first: true });
    expect(prose.update(0, "{\"text\":\"The lamp")).toBeUndefined();
    expect(prose.update(0, "{\"text\":\"The lamp gutters.")).toEqual({ id: "draft:1", text: "The lamp gutters.", first: false });
    expect(prose.end(0, { text: "The lamp gutters." })).toBeUndefined();
    expect(prose.delivered()).toBe("draft:1");
    expect(prose.delivered()).toBeUndefined();
  });

  it("follows only the delivering calls", () => {
    const prose = new LiveDeliveryProse("draft");
    prose.start(0, "look");
    expect(prose.update(0, json("not prose"))).toBeUndefined();
    expect(prose.end(0, { text: "not prose" })).toBeUndefined();
    prose.start(1, undefined);
    expect(prose.update(1, json("unnamed"))).toBeUndefined();
    expect(prose.delivered()).toBeUndefined();
    prose.start(0, "apply");
    expect(prose.update(0, JSON.stringify({ effects: [], narrate: "Bookkeeping and prose." }))?.text).toBe("Bookkeeping and prose.");
  });

  it("keeps identical resent prose and replaces different prose in place, only once it is complete (owner, 2026-10-03)", () => {
    const prose = new LiveDeliveryProse("draft");
    prose.start(0, "narrate");
    prose.update(0, json("He nods."));
    prose.end(0, { text: "He nods." });
    prose.messageEnded();
    // The kernel refused that delivery; the Keeper sends the same prose again.
    prose.start(0, "narrate");
    expect(prose.update(0, json("He no"))).toBeUndefined();
    expect(prose.end(0, { text: "He nods." })).toBeUndefined();
    prose.messageEnded();
    // And then different prose: nothing changes while it streams, and it takes the same place when it is complete.
    prose.start(0, "narrate");
    expect(prose.update(0, json("He shrugs"))).toBeUndefined();
    expect(prose.end(0, { text: "He shrugs." })).toEqual({ id: "draft:1", text: "He shrugs.", first: false });
    expect(prose.delivered()).toBe("draft:1");
  });

  it("lets a later delivery fill a draft that never showed anything", () => {
    const prose = new LiveDeliveryProse("draft");
    prose.start(0, "narrate");
    prose.update(0, "{\"text\":\"");
    prose.messageEnded();
    prose.start(0, "narrate");
    expect(prose.update(0, json("Now it speaks."))).toEqual({ id: "draft:1", text: "Now it speaks.", first: true });
  });

  it("starts each player turn with no draft, so the next one is a new card", () => {
    const prose = new LiveDeliveryProse("draft");
    prose.start(0, "narrate");
    prose.update(0, json("Turn one."));
    prose.startTurn();
    expect(prose.delivered()).toBeUndefined();
    prose.start(0, "narrate");
    expect(prose.update(0, json("Turn two."))).toEqual({ id: "draft:2", text: "Turn two.", first: true });
  });
});
