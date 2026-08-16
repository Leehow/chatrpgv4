# Pi-Coc Electron Design QA

- final result: passed
- active implementation track: `pi-coc`
- source reference: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/final-light-synthesis.png`
- implementation screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/implementation-active-final.png`
- combined comparison: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/source-vs-implementation.png`
- dice implementation screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/dice-light-qa.png`
- dice reference comparison: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/dice-reference-comparison.png`
- complete-parameter dice screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/dice-full-params-qa.png`
- complete-parameter comparison: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/dice-full-params-comparison.png`
- SAN multi-roll screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/san-group-optimized.jpg`
- damage multi-roll screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-group-optimized.jpg`
- combat-metadata UI fixture screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-metadata-fixture-final.jpg`
- melee Dodge opposed screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-dodge-final.png`
- melee Fight Back opposed screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-opposed-final.png`
- bonus-die selection screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-bonus-die-final.png`
- melee comparison: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-opposed-comparison.png`
- canonical initiative screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-initiative-final.png`
- fixed SAN receipt screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/san-check-final.png`
- post-refresh combat rendering screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/combat-rendered-final.png`
- damage enum source screenshot: `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-b6d63851-e281-4388-adb5-b003b21d41bc.png` (`1356 x 412`, focused card crop)
- corrected damage screenshot: `/Users/haoli/.codex/visualizations/2026/08/16/01a00acf-ab10-7ac0-b2eb-11589813f912/pi-coc-redesign/damage-applied-fixed.png` (`988 x 869`, CSS viewport at 1x)
- viewport: `1440 x 900`
- source dimensions: `1586 x 992`
- implementation dimensions: `1440 x 900`

## States reviewed

- Empty campaign selection in the default light theme.
- Active campaign with a real player message, Keeper narration, scene title, investigator data, and composer.
- A historical real-play public Language check rendered as a structured D100 receipt with skill, difficulty, roll, target, and outcome.
- A real-play SAN group with SAN check, SAN loss, and two firearm checks preserved in one ordered four-row receipt.
- A real-play firearm group with two attacks and the bound 4D6 amount roll preserved in one ordered three-row receipt.
- A disposable UI-only combat metadata fixture covering attack, Dodge, Fight Back, bonus die, point-blank, damage, armor absorption, and HP change. This fixture is visual QA, not actual-play acceptance.
- Canonical melee settlement projection for both Dodge and Fight Back: the attack and defense rolls are paired across intervening causal prose, rendered once, compared side by side, and followed by the authoritative damage receipt when present.
- Canonical percentile bonus-die detail: both tens dice, the shared units die, all resulting D100 candidates, and the selected lower result are visible. The same component labels penalty dice and selects the higher result when canonical penalty data is present.
- Canonical active-combat order: current round, current actor, DEX/action value, acted/excluded state, and ready-firearm DEX+50 treatment are projected from `save/combat.json`; no initiative roll is invented.
- Dedicated SAN settlement: the percentile outcome, loss expression, actual loss, and before/after SAN values are presented as one fixed card while any unrelated rolls in the same finalization remain visible below it.
- Cold bridge restart / host-opening attach: after the live plain-text stream settles, the UI rereads the canonical typed transcript and restores SAN/combat cards instead of leaving protocol-shaped prose on screen.
- Light dossier, system-following, and dark ritual appearance choices.
- Character, items, and time panel tabs with live campaign data.
- Minimum desktop viewport at `1024 x 700`; no horizontal overflow and the right dossier collapses to its compact control.

## Comparison history

1. Initial active-state comparison found insufficient Keeper-text contrast in dark mode.
2. Keeper prose was bound to the theme foreground token and rechecked at `oklch(0.91 0.018 82)` in dark mode.
3. Final side-by-side comparison confirmed the selected light editorial structure, compact campaign rail, centered scene marker, open Keeper prose, parchment player note, right dossier tabs, and brass/rust accents.
4. A focused dice-region comparison confirmed that the implementation preserves the reference card's bordered parchment treatment, icon anchor, strong roll value, target denominator, and semantic outcome color. The implementation intentionally omits the mock's invented consequence sentence because only authoritative finalization content may be shown.
5. User review found the initial-impression summary incomplete. The final pass adds an explicit `初印象检定` title plus authoritative APP, Credit Rating, and governing-value detail; the revised side-by-side image confirms the three opening cards carry those parameters without reintroducing protocol text.
6. User review found multi-roll SAN/combat segments incomplete. The final pass replaces the one-roll card with an ordered settlement group, renders every bound public roll, and enriches rows from canonical `save/combat.json` when present. Real `peru2` evidence now shows 14 groups / 21 finalized rolls plus the 3 opening receipts, with no marker leakage or horizontal overflow.
7. User review found that the combat choice cards did not explain the post-choice state. The final pass pairs canonical attack/defense receipts even when one causal prose segment sits between them, shows the defense-specific tie rule and winner reason, keeps damage beneath the opposed result, and expands bonus/penalty percentile dice into tens/units candidates with the adopted result marked.
8. User review found one attached pi-coc opening remained raw and asked for fixed SAN and initiative surfaces. The final pass refreshes the typed transcript after attached streams, adds a stable SAN card, and presents the canonical DEX order as a compact combat ledger. Chaosium's Quick-Start rules and Roll20's Free Basic Rules both confirm DEX order and the readied-firearm DEX+50 exception.
9. User review found the backend settlement enum `damage_applied` exposed as green result copy. The focused source and revised browser capture were reviewed together. The fix maps the enum to the neutral player-facing label `已结算`; roll 9, expression, HP 8 → 0, and faces 4 + 3 remain unchanged. The post-fix page contains zero visible `damage_applied` strings.

## Fidelity surfaces

- Fonts and typography: passed. Display serif hierarchy, compact sans-serif metadata, and tabular roll numerals remain legible at the reviewed desktop density.
- Spacing and layout rhythm: passed. The card aligns with the Keeper prose column, keeps a compact horizontal scan path, and does not disturb the transcript's vertical order.
- Colors and tokens: passed. Light parchment, rust primary, muted brass, and success/failure semantic colors use the existing theme tokens; dark-theme tokens remain available through the appearance control.
- Image and icon fidelity: passed. Existing generated AI Keeper brand marks are retained; the dice affordance uses the installed icon library and no placeholder or CSS-drawn asset.
- Copy and content: passed. Check type, skill/NPC, difficulty, rolled value, target, outcome, APP, Credit Rating, governing value, SAN transition, die faces, attack/defense role, defense choice, structured modifiers, damage, armor, and HP transition come from public roll receipts or canonical combat state; no Keeper-prose keyword inference is used.
- Damage settlement copy: passed. Machine enum text is localized as a neutral settlement state rather than colored as a skill-check success; no structural or spacing change was needed.

## Findings

- No actionable P0, P1, or P2 differences remain for the structured public-check state.
- P3: generic `dice_expression` rolls remain labeled `结果骰` unless canonical combat metadata identifies them as damage; this avoids guessing semantics from free-form reasons.

## Interaction and console checks

- Appearance menu: passed for all three choices and persists the selected mode.
- Panel tabs: passed for character, items, and time views.
- Campaign selection and transcript rendering: passed against the existing `desktop-a1-smoke` campaign.
- Structured dice rendering: passed against a preserved copy of the `peru2` campaign; the API projected 3 opening receipts plus 14 finalized settlement groups containing all 21 ordered public rolls. The renderer produced all 24 visible roll rows with no `[roll]` / `[/in_game]` marker leakage and no horizontal overflow.
- Combat metadata rendering: passed with a disposable UI-only copy whose canonical `save/combat.json` binds attack, defense, Fight Back, Dodge, bonus/penalty sources, damage, armor, and HP fields. This is component/projection evidence only; the preserved real campaign has no successful combat state and is not claimed as full combat acceptance.
- Melee opposed rendering: passed against preserved `melee-ui-1` records. The browser rendered two opposed cards (Dodge and Fight Back), one canonical bonus-die breakdown, no duplicate attack roll inside each settlement, no horizontal overflow, and no console errors or warnings.
- Host-opening typed refresh, SAN, and initiative: passed after a full Node bridge restart against preserved `melee-ui-1`. The browser rendered two SAN cards, the Fight Back opposed card plus damage, and the round-2 initiative ledger with Walter Corbitt current and Thomas Hayes excluded; no console errors were recorded.
- Damage-card rendering produced no component error. The page still emits an unrelated pre-existing `Progress value NaN` warning from another surface; it does not affect this focused settlement-card fix and remains outside this request.

Dice groups consume the authoritative ordered `public_check` segments and public roll bundle from each turn-finalization receipt. When canonical combat state exists, the web projection joins by roll id and emits only a closed player-safe subset. The renderer does not fabricate rolls, keyword-match Keeper prose, or expose non-public roll fields; narration remains in canonical order around each group.
