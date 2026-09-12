/**
 * The COC Keeper extension's difficulty settings section (contract §33.5).
 *
 * Plain ESM with no imports, on purpose -- the renderer imports this file as a module and calls
 * `createComponent(React)` with its own React instance (controlled-component-loader.ts), the same
 * shape as panel.js and mods-panel.js.
 *
 * A 1920s wireless dial picks the preset (contract §33.1: extreme x0.5, hard x1, normal x2,
 * easy x4); the fifth stop unfolds a newspaper-styled panel of the §33.3 custom knobs. Every row
 * is optional: a blank line keeps the rulebook default and is omitted from the stored object.
 *
 * THE CHROME IS DATA TOO (contract §23). This file keeps no word table: the words arrive from the
 * host's `ui-words` answer (`ui.words.difficulty`, read from content/ui/<tag>/difficulty.json),
 * and a key the surface lacks renders as the key, because an identifier is a visible gap and
 * another language's word is a silent one.
 *
 * The UI validates for feedback only (closed dice grammar and the §33.3 ranges). The kernel
 * re-validates everything at campaign.create; this file is never the authority.
 */

const STYLE_ID = "pipicoc-difficulty-style";
const CSS = `
.coc-diff{--dial-bakelite:#2e2015;--dial-brass:#b98a3e;--dial-glass:#e8dcc0;--dial-ink:#33291f;
  --paper:#f4ecd8;--paper-ink:#1f1a14;--paper-muted:#6f6250;--paper-rule:#b7a887;
  box-sizing:border-box;display:flex;flex-direction:column;gap:14px;max-width:560px;
  color:var(--text);font-size:13px;line-height:1.6}
.coc-diff *{box-sizing:border-box}
.coc-diff-radio{background:linear-gradient(180deg,#3a2a1c,var(--dial-bakelite));border-radius:10px;
  padding:16px 18px 12px;box-shadow:inset 0 1px 0 #ffffff22,0 4px 14px #1c100866}
.coc-diff-band{position:relative;border:3px solid var(--dial-brass);border-radius:6px;
  background:linear-gradient(180deg,#f2e8cf,var(--dial-glass));padding:10px 14px 6px}
.coc-diff-band-caption{display:block;text-align:center;font:600 11px/1.4 ui-serif,Georgia,serif;
  letter-spacing:.18em;text-transform:uppercase;color:#7a6440;margin-bottom:6px}
.coc-diff-needle{appearance:none;-webkit-appearance:none;display:block;width:100%;height:26px;margin:0;
  background:repeating-linear-gradient(90deg,#8a7452 0 1px,transparent 1px 12.5%);cursor:pointer}
.coc-diff-needle::-webkit-slider-runnable-track{height:26px;background:transparent}
.coc-diff-needle::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:4px;height:26px;
  background:#a03a2a;box-shadow:0 0 0 1px #5c1d14;border-radius:1px}
.coc-diff-needle::-moz-range-track{height:26px;background:transparent}
.coc-diff-needle::-moz-range-thumb{width:4px;height:26px;border:0;background:#a03a2a;
  box-shadow:0 0 0 1px #5c1d14;border-radius:1px}
.coc-diff-needle:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.coc-diff-stops{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:10px}
.coc-diff-stop{display:flex;flex-direction:column;align-items:center;gap:1px;border:1px solid transparent;
  border-radius:6px;background:transparent;padding:6px 2px;cursor:pointer;font:inherit;color:#d9c9a8}
.coc-diff-stop:hover{background:#ffffff14}
.coc-diff-stop[aria-pressed="true"]{border-color:var(--dial-brass);background:#f4b84a1f;color:#f0dfb2}
.coc-diff-stop-name{font:600 12px/1.4 ui-serif,Georgia,serif;letter-spacing:.04em}
.coc-diff-stop-pct{font:500 10px/1.4 ui-monospace,monospace;color:#a98f63;font-variant-numeric:tabular-nums}
.coc-diff-note{margin:0;color:var(--muted);font-size:12px}
.coc-diff-paper{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-rule);
  box-shadow:0 3px 10px #2a1c0e22;padding:14px 18px 16px;font-family:ui-serif,Georgia,serif}
.coc-diff-masthead{text-align:center;border-bottom:3px double var(--paper-ink);padding-bottom:8px;margin-bottom:10px}
.coc-diff-extra{display:block;font:800 13px/1.3 inherit;letter-spacing:.3em}
.coc-diff-headline{margin:4px 0 0;font:700 19px/1.3 inherit;letter-spacing:.01em}
.coc-diff-hint{margin:0 0 10px;text-align:center;font:italic 12px/1.5 inherit;color:var(--paper-muted)}
.coc-diff-ads{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.coc-diff-ad{border:1px solid var(--paper-rule);padding:8px 10px;break-inside:avoid}
.coc-diff-ad-wide{grid-column:1/-1}
.coc-diff-ad-title{margin:0 0 6px;font:700 12px/1.4 inherit;letter-spacing:.06em;text-transform:uppercase;
  border-bottom:1px solid var(--paper-rule);padding-bottom:3px}
.coc-diff-row{display:flex;align-items:baseline;gap:8px;margin:4px 0}
.coc-diff-row-label{flex:1;min-width:0;font-size:12px;color:var(--paper-muted);overflow-wrap:anywhere}
.coc-diff-input{flex:0 0 auto;width:110px;font:inherit;font-size:13px;color:var(--paper-ink);
  background:#fffdf4;border:1px solid var(--paper-rule);border-radius:2px;padding:3px 6px}
.coc-diff-input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.coc-diff-input[aria-invalid="true"]{border-color:#a03a2a;box-shadow:0 0 0 1px #a03a2a}
.coc-diff-select{flex:0 0 auto;width:110px;font:inherit;font-size:13px;color:var(--paper-ink);
  background:#fffdf4;border:1px solid var(--paper-rule);border-radius:2px;padding:3px 4px}
.coc-diff-err{margin:6px 0 0;font-size:12px;font-style:italic;color:#a03a2a}
.coc-diff-err::before{content:"* "}
.coc-diff-alert{margin:0;color:var(--danger);font-size:12px}
`;

/** The closed dice grammar of contract §33.3 (case-insensitive), with N >= 1 checked by parseDice. */
export const DICE_GRAMMAR = /^\d{1,2}D(4|6|8|10|12|20|100)(\+\d{1,2})?$/i;

/** The dial's stops: the four §33.1 presets, then the custom stop. */
export const PRESETS = ["extreme", "hard", "normal", "easy"];
export const PRESET_PERCENT = [50, 100, 200, 400];
const CUSTOM_STOP = PRESETS.length;
const DEFAULT_STOP = 2; // normal x2: the product default when nothing was ever stored (contract §33.1)

/** The settings key of contract §33.1, app scope of the host settings JSON. */
export const SETTINGS_EXTENSION = "coc-keeper";
export const SETTINGS_KEY = "ext.coc-keeper.difficulty";

/** The two rulebook pool expressions characteristic_dice may replace, keyed as characteristic-dice.json keys them. */
const POOL_PRIMARY = "3D6";
const POOL_SECONDARY = "2D6+6";

function isDice(value) {
  if (typeof value !== "string" || !DICE_GRAMMAR.test(value.trim())) return false;
  return Number.parseInt(value.trim(), 10) >= 1;
}

/** One blank line per knob: an empty draft is the rulebook standard with the dial on hard. */
export function blankDraft() {
  return {
    stop: DEFAULT_STOP,
    dicePrimary: "", diceSecondary: "",
    charMin: "", charMax: "",
    luckKind: "dice", luckValue: "",
    occupationKind: "multiplier", occupationValue: "",
    interestKind: "multiplier", interestValue: "",
    skillCap: "",
  };
}

/** The stored §33.1 setting as a draft, or a blank draft for anything this file did not write. */
export function draftFromSetting(setting) {
  const draft = blankDraft();
  if (!setting || typeof setting !== "object" || Array.isArray(setting)) return draft;
  if (setting.mode === "preset" && PRESETS.includes(setting.preset)) {
    draft.stop = PRESETS.indexOf(setting.preset);
    return draft;
  }
  if (setting.mode !== "custom" || !setting.custom || typeof setting.custom !== "object") return draft;
  draft.stop = CUSTOM_STOP;
  const custom = setting.custom;
  const dice = custom.characteristic_dice && typeof custom.characteristic_dice === "object" ? custom.characteristic_dice : {};
  if (typeof dice[POOL_PRIMARY] === "string") draft.dicePrimary = dice[POOL_PRIMARY];
  if (typeof dice[POOL_SECONDARY] === "string") draft.diceSecondary = dice[POOL_SECONDARY];
  if (typeof custom.characteristic_min === "number") draft.charMin = String(custom.characteristic_min);
  if (typeof custom.characteristic_max === "number") draft.charMax = String(custom.characteristic_max);
  if (custom.luck && typeof custom.luck === "object") {
    if (typeof custom.luck.fixed === "number") { draft.luckKind = "fixed"; draft.luckValue = String(custom.luck.fixed); }
    else if (typeof custom.luck.dice === "string") { draft.luckKind = "dice"; draft.luckValue = custom.luck.dice; }
  }
  for (const [key, kind, field] of [["occupation_points", "occupationKind", "occupationValue"],
    ["interest_points", "interestKind", "interestValue"]]) {
    const budget = custom[key];
    if (!budget || typeof budget !== "object") continue;
    if (typeof budget.fixed === "number") { draft[kind] = "fixed"; draft[field] = String(budget.fixed); }
    else if (typeof budget.multiplier === "number") { draft[kind] = "multiplier"; draft[field] = String(budget.multiplier); }
  }
  if (typeof custom.skill_cap === "number") draft.skillCap = String(custom.skill_cap);
  return draft;
}

function number(text) {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The draft as the stored §33.1 shape. A blank knob is omitted, so an untouched custom panel
 * stores `{mode:"custom", custom:{}}` -- valid, and equal to hard (contract §33.3).
 */
export function buildSetting(draft) {
  if (draft.stop !== CUSTOM_STOP) return {mode: "preset", preset: PRESETS[draft.stop] ?? "normal"};
  const custom = {};
  const dice = {};
  if (draft.dicePrimary.trim()) dice[POOL_PRIMARY] = draft.dicePrimary.trim();
  if (draft.diceSecondary.trim()) dice[POOL_SECONDARY] = draft.diceSecondary.trim();
  if (Object.keys(dice).length) custom.characteristic_dice = dice;
  const min = number(draft.charMin), max = number(draft.charMax);
  if (min !== undefined) custom.characteristic_min = min;
  if (max !== undefined) custom.characteristic_max = max;
  const luck = number(draft.luckValue);
  if (draft.luckKind === "fixed" && luck !== undefined) custom.luck = {fixed: luck};
  if (draft.luckKind === "dice" && draft.luckValue.trim()) custom.luck = {dice: draft.luckValue.trim()};
  for (const [key, kind, field] of [["occupation_points", draft.occupationKind, draft.occupationValue],
    ["interest_points", draft.interestKind, draft.interestValue]]) {
    const value = number(field);
    if (value === undefined) continue;
    custom[key] = kind === "fixed" ? {fixed: value} : {multiplier: value};
  }
  const cap = number(draft.skillCap);
  if (cap !== undefined) custom.skill_cap = cap;
  return {mode: "custom", custom};
}

/**
 * The §33.3 shape-and-range check, for feedback only: a map from draft field to an error key of
 * the difficulty surface. The kernel re-validates everything at campaign.create.
 */
export function validateSetting(setting) {
  const errors = {};
  if (setting.mode !== "custom") return errors;
  const custom = setting.custom;
  const dice = custom.characteristic_dice ?? {};
  if (dice[POOL_PRIMARY] !== undefined && !isDice(dice[POOL_PRIMARY])) errors.dicePrimary = "error_dice";
  if (dice[POOL_SECONDARY] !== undefined && !isDice(dice[POOL_SECONDARY])) errors.diceSecondary = "error_dice";
  const bound = (value) => Number.isInteger(value) && value % 5 === 0 && value >= 5 && value <= 450;
  if (custom.characteristic_min !== undefined && !bound(custom.characteristic_min)) errors.charMin = "error_multiple_five";
  if (custom.characteristic_max !== undefined && !bound(custom.characteristic_max)) errors.charMax = "error_multiple_five";
  const low = bound(custom.characteristic_min) ? custom.characteristic_min : undefined;
  const high = bound(custom.characteristic_max) ? custom.characteristic_max : undefined;
  // A lone bound is checked against the rulebook creation bound it does not replace (15/90).
  if (low !== undefined && low >= (high ?? 90)) errors[high === undefined ? "charMin" : "charMax"] = "error_bounds";
  else if (high !== undefined && high <= (low ?? 15)) errors.charMax = "error_bounds";
  if (custom.luck) {
    if (custom.luck.fixed !== undefined && !bound(custom.luck.fixed)) errors.luckValue = "error_multiple_five";
    if (custom.luck.dice !== undefined && !isDice(custom.luck.dice)) errors.luckValue = "error_dice";
  }
  for (const [key, field] of [["occupation_points", "occupationValue"], ["interest_points", "interestValue"]]) {
    const budget = custom[key];
    if (!budget) continue;
    if (budget.multiplier !== undefined && (budget.multiplier < 0.25 || budget.multiplier > 8)) errors[field] = "error_range";
    if (budget.fixed !== undefined && (budget.fixed < 0 || budget.fixed > 2000)) errors[field] = "error_range";
  }
  if (custom.skill_cap !== undefined &&
    (!Number.isInteger(custom.skill_cap) || custom.skill_cap < 1 || custom.skill_cap > 500))
    errors.skillCap = Number.isInteger(custom.skill_cap) ? "error_range" : "error_integer";
  return errors;
}

/** A caption from the answer's `ui` block, or the key itself: a visible gap, never another language. */
function word(ui, key) {
  const table = ui && typeof ui === "object" && ui.words && typeof ui.words === "object" ? ui.words.difficulty : undefined;
  const value = table && typeof table === "object" ? table[key] : undefined;
  return typeof value === "string" ? value : key;
}

export function createComponent(React) {
  const h = React.createElement;
  const {useEffect, useRef, useState} = React;

  return function DifficultySection(props) {
    const api = props.api ?? {};
    const host = props.ctx && props.ctx.host;
    const [ui, setUi] = useState(undefined);
    const [draft, setDraft] = useState(undefined);
    const [errors, setErrors] = useState({});
    const [saveFailed, setSaveFailed] = useState(false);
    const generation = useRef(0);
    const t = (key) => word(ui, key);

    useEffect(() => {
      const style = globalThis.document && globalThis.document.getElementById(STYLE_ID);
      if (!style && globalThis.document) {
        const tag = globalThis.document.createElement("style");
        tag.id = STYLE_ID;
        tag.textContent = CSS;
        globalThis.document.head.appendChild(tag);
      }
    }, []);

    useEffect(() => {
      const current = ++generation.current;
      (async () => {
        let words;
        if (api.invoke) {
          const result = await api.invoke("ui-words", {}).catch(() => undefined);
          if (result && result.ok && result.data && result.data.ui) words = result.data.ui;
        }
        let stored;
        if (host && host.getExtensionSettings) {
          stored = await host.getExtensionSettings(SETTINGS_EXTENSION).catch(() => undefined);
        }
        if (current !== generation.current) return;
        setUi(words);
        setDraft(draftFromSetting(stored && stored[SETTINGS_KEY]));
      })();
      return () => { generation.current++; };
    }, [api, host]);

    function update(patch) {
      const next = {...draft, ...patch};
      setDraft(next);
      const setting = buildSetting(next);
      const found = validateSetting(setting);
      setErrors(found);
      setSaveFailed(false);
      if (Object.keys(found).length || !host || !host.updateExtensionSettings) return;
      void host.updateExtensionSettings(SETTINGS_EXTENSION, {[SETTINGS_KEY]: setting}).then((result) => {
        if (!result || result.ok !== true) setSaveFailed(true);
      }, () => setSaveFailed(true));
    }

    if (draft === undefined) return h("div", {className: "coc-diff"}, "...");

    const field = (key, label, control, wide) =>
      h("div", {className: `coc-diff-ad${wide ? " coc-diff-ad-wide" : ""}`},
        h("h4", {className: "coc-diff-ad-title"}, t(label)),
        control,
        errors[key] ? h("p", {className: "coc-diff-err", role: "alert"}, t(errors[key])) : null);

    const textRow = (key, labelKey, inputProps) =>
      h("div", {className: "coc-diff-row"},
        h("label", {className: "coc-diff-row-label", htmlFor: `coc-diff-${key}`}, t(labelKey)),
        h("input", {
          id: `coc-diff-${key}`, className: "coc-diff-input", "data-testid": `coc-diff-${key}`,
          "aria-invalid": errors[key] ? "true" : undefined, ...inputProps,
        }));

    const budgetRow = (kindKey, valueKey, labelKey, kinds) =>
      h(React.Fragment, null,
        h("div", {className: "coc-diff-row"},
          h("label", {className: "coc-diff-row-label", htmlFor: `coc-diff-${valueKey}`}, t(labelKey)),
          h("select", {
            className: "coc-diff-select", "data-testid": `coc-diff-${kindKey}`, value: draft[kindKey],
            "aria-label": t(labelKey),
            onChange: (event) => update({[kindKey]: event.target.value}),
          }, kinds.map((kind) => h("option", {key: kind, value: kind}, t(`mode_${kind}`)))),
          h("input", {
            id: `coc-diff-${valueKey}`, className: "coc-diff-input", "data-testid": `coc-diff-${valueKey}`,
            type: draft[kindKey] === "dice" ? "text" : "number",
            step: draft[kindKey] === "multiplier" ? "any" : draft[kindKey] === "fixed" && kinds.includes("dice") ? 5 : 1,
            value: draft[valueKey], "aria-invalid": errors[valueKey] ? "true" : undefined,
            onChange: (event) => update({[valueKey]: event.target.value}),
          })));

    const stops = [...PRESETS, "custom"];
    return h("div", {className: "coc-diff", role: "region", "aria-label": t("dial_caption")},
      h("div", {className: "coc-diff-radio"},
        h("div", {className: "coc-diff-band"},
          h("span", {className: "coc-diff-band-caption"}, t("dial_band")),
          h("input", {
            type: "range", className: "coc-diff-needle", "data-testid": "coc-diff-dial",
            min: 0, max: CUSTOM_STOP, step: 1, value: draft.stop, "aria-label": t("dial_caption"),
            onChange: (event) => update({stop: Number(event.target.value)}),
          })),
        h("div", {className: "coc-diff-stops"},
          stops.map((name, index) => h("button", {
            key: name, type: "button", className: "coc-diff-stop", "data-testid": `coc-diff-stop-${name}`,
            "aria-pressed": draft.stop === index ? "true" : "false",
            onClick: () => update({stop: index}),
          },
            h("span", {className: "coc-diff-stop-name"}, t(`preset_${name}`)),
            h("span", {className: "coc-diff-stop-pct"},
              index < PRESETS.length ? `${PRESET_PERCENT[index]}%` : "*"))))),
      h("p", {className: "coc-diff-note"},
        draft.stop === DEFAULT_STOP ? `${t("preset_hard_note")} — ${t("applies_note")}` : t("applies_note")),
      draft.stop === CUSTOM_STOP && h("div", {className: "coc-diff-paper"},
        h("div", {className: "coc-diff-masthead"},
          h("span", {className: "coc-diff-extra"}, t("custom_masthead")),
          h("h3", {className: "coc-diff-headline"}, t("custom_headline"))),
        h("p", {className: "coc-diff-hint"}, t("custom_hint")),
        h("div", {className: "coc-diff-ads"},
          field("dicePrimary", "characteristic_dice", h(React.Fragment, null,
            textRow("dicePrimary", "pool_primary", {
              type: "text", placeholder: POOL_PRIMARY, value: draft.dicePrimary, spellCheck: false,
              onChange: (event) => update({dicePrimary: event.target.value}),
            }),
            textRow("diceSecondary", "pool_secondary", {
              type: "text", placeholder: POOL_SECONDARY, value: draft.diceSecondary, spellCheck: false,
              "aria-invalid": errors.diceSecondary ? "true" : undefined,
              onChange: (event) => update({diceSecondary: event.target.value}),
            }),
            errors.diceSecondary ? h("p", {className: "coc-diff-err", role: "alert"}, t(errors.diceSecondary)) : null), true),
          field("charMin", "characteristic_min", textRow("charMin", "characteristic_min", {
            type: "number", step: 5, min: 5, max: 450, value: draft.charMin,
            onChange: (event) => update({charMin: event.target.value}),
          })),
          field("charMax", "characteristic_max", textRow("charMax", "characteristic_max", {
            type: "number", step: 5, min: 5, max: 450, value: draft.charMax,
            onChange: (event) => update({charMax: event.target.value}),
          })),
          field("luckValue", "luck", budgetRow("luckKind", "luckValue", "luck", ["dice", "fixed"])),
          field("occupationValue", "occupation_points",
            budgetRow("occupationKind", "occupationValue", "occupation_points", ["multiplier", "fixed"])),
          field("interestValue", "interest_points",
            budgetRow("interestKind", "interestValue", "interest_points", ["multiplier", "fixed"])),
          field("skillCap", "skill_cap", textRow("skillCap", "skill_cap", {
            type: "number", step: 1, min: 1, max: 500, value: draft.skillCap,
            onChange: (event) => update({skillCap: event.target.value}),
          })))),
      saveFailed ? h("p", {className: "coc-diff-alert", role: "alert"}, t("save_failed")) : null);
  };
}
