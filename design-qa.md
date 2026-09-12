# PipiCOC writable papers — visual and interaction QA

final result: passed

## Extracted seal layer

The approved original stamp is now an independent RGBA asset:
`pipicoc/assets/investigator-seal.png` (281 × 279). A worker performed deterministic
pixel extraction from the original concept crop `[365,667,646,946]`. The red ink
shape is original: star, `档案`, worn rings and faint broken marks were not redrawn.
The RGB is a consistent rust ink colour while 17,032 partial-alpha pixels retain
the uneven print density; 61,328 pixels are fully transparent. Paper colour and
the brown photo corner were rejected from the alpha mask.

The backplate's old stamp was removed only inside `[363,663,649,947]`, using
neighbouring paper texture and a mirrored clean photo corner. Pixel audit found
no red-chroma residue above the extraction threshold and no changes outside that
rectangle. The renderer order is backplate, optional future portrait, then seal;
text remains above all artwork. This lets a later generated portrait replace the
blank photo while the same stamp still crosses its lower-right edge.

Evidence: `.cache/passport-design/seal-extraction/final-background-qa.png` checks
the transparent seal on parchment, white, dark and cyan; `.cache/passport-design/
seal-layers/texture-candidate-comparison.png` compares the old and cleaned plate.
The integrated component was inspected again at a 375-pixel sidebar width.

final result: passed

## Comparison target and evidence

- Source visual truth: the user's supplied inventory screenshot,
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-e1313f07-747a-4feb-aea9-aa3cfed2e192.png`,
  plus the existing Terracotta product theme in `Electron/packages/ui/src/theme-registry.ts`.
- Implementation screenshot:
  `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/output/mods-paper-20260908/paper-editor.png`.
  Captured with Chrome's own screenshot command, operated through CUA.
- Source is an 824 x 734 cropped sidebar; implementation is a new modal over that product.
  These intentionally differ in state and crop. This is a style and usability
  comparison for the requested extension, not a claim of pixel-identical cloning.
- Implementation capture is 3024 x 1520 pixels. Native Chrome was used after the
  in-app browser rejected localhost and the Chrome browser connector was unavailable.
  CSS viewport/density were not instrumented; no pixel-normalized fidelity score
  is claimed. Both actual images were opened together in one comparison input.
- State: a real Keeper-created commission slip, restored to its acquisition text.
  The same paper was also inspected in the alternate plain renderer.

## Findings and required fidelity surfaces

No actionable P0/P1/P2 visual findings remain for this desktop flow.

- Fonts/type: period-style serif heading and writing contrast with smaller control
  text; lines and punctuation are readable, and the displayed note is not truncated.
  This is an intentional paper treatment within the existing product.
- Spacing/layout: a centered modal, consistent inset writing margins and a persistent
  footer keep Close, Save and Restore reachable. The writing region scrolls separately.
- Colors/tokens: cream paper, brown ink and terracotta controls extend the supplied
  warm product palette. Focus and unsaved states remain distinguishable.
- Image quality: the background is an actual generated paper texture, shipped as
  an optimized JPEG. It remains quiet under text; there are no fake torn edges,
  rasterized controls, clipped illustrations or decorative marks replacing assets.
- Copy/content: the visible commission text comes from the genuine test campaign.
  Restore returns the original wording; controls distinguish unsaved changes from
  edits already saved. The image clearly shows the unchanged acquisition-original
  state, so Save/Restore being disabled is expected.

The full-view image exposes the heading, complete note, margins and all footer
controls clearly. A separate detail crop was unnecessary.

## Interaction verification

- Opened the actual commission slip, including after it was placed inside the notebook.
- Replaced its text with Chinese multiline notes; saved, closed, reopened, and
  verified persistence. Restore returned the original commission text.
- Opened an actual blank notebook, wrote text, exercised the unsaved-close guard,
  continued editing, saved, and restored the blank acquisition state.
- Changed Mod order and verified persistence after page reload.
- Installed a local declarative editor fixture in the isolated test home, enabled
  it later in the order, and observed the plain renderer. Moving it before Enhanced
  Items restored the paper renderer with both Mods still enabled. Override ownership
  was visible in the manager.
- Kernel comparisons verified no campaign, turn, investigator, source-definition or
  acquisition-original changes during the four UI save/reset operations.
- Console inspection found the existing server-preview `browser is unavailable`
  error and a pre-pairing favicon 401, plus existing history debug warnings. No paper
  or ordering action introduced a console error.

## Comparison history and residual scope

The first visual comparison passed; no P0/P1/P2 visual correction loop was needed.
The real-play initialization fix was functional, not a design-QA iteration.
Native packaged-App replacement and a separate small-screen device run are distinct
from this verified desktop browser result. Current UI handles narrow/short viewports
in CSS, but no mobile-device acceptance is claimed.

## Implementation checklist

- [x] Paper texture and product typography inspected in the actual UI.
- [x] Read, edit, save, reopen, reset and unsaved-close behavior exercised.
- [x] Actual load-order override and reversal exercised.
- [x] Original data and fictional progress compared before/after edits.
- [x] Screenshot and data evidence retained outside the disposable worktree.

---

# Investigator credential card QA — 2026-09-11

final result: passed

Scope: the existing right-sidebar identity component, rendered from `pipicoc/panel.js` with visual fixtures. This is component UI validation, not campaign playtest or packaged-App acceptance.

Source visual: `/Users/haoli/.codex/generated_images/01a08f65-6f5c-7a33-8d01-650cb457cd01/exec-11728073-3215-436e-ab94-fb203468899c.png` (1289 × 1220). The user's subsequent corrections are authoritative: small live title, refresh outside, an unlabelled year, larger seal, aligned language names and values.

Implementation: `.cache/passport-design/identity-final.png` (570 × 608 browser viewport). The first fixture is a 375 CSS-pixel sidebar with a 343-pixel outer card; the reference was assessed at that card width, excluding browser/preview chrome. This is a responsive interpretation, not a pixel-identical image reproduction. Source and implementation were opened together in the same comparison tool input.

Narrow evidence: `.cache/passport-design/identity-narrow.png`, a measured 220-pixel sidebar and 188-pixel outer card; content reflows vertically without horizontal overflow. At 320 pixels, the long German name also wraps without overflow. Screenshot density is 1 pixel per CSS pixel in the final default viewport; an earlier temporary viewport override was reset.

## Findings and corrections

- Initial language rows placed the native language name in the value column and the other language in the label column. Corrected to one shared caption and a two-column names/values grid. Browser measurements show both names at x=233 and both values at x=348, ending at x=364.
- Initial seal was too small. Replaced the generated mount artwork with a larger seal, approximately 1.6 times its prior diameter. Two intermediate generated images with baked checkerboards were rejected. Final artwork has a white exterior blended into the paper with CSS multiply; no checkerboard or edge clipping is visible.
- No actionable P0/P1/P2 findings remain for this component. No custom portrait or image-generation interaction is implied by the blank mount.

## Fidelity and behavior

- Typography: real DOM text, existing serif font stack, prominent name, quieter title and year. Long words wrap; title/body direction uses HTML `dir` and `bdi`, without language detection.
- Layout: paper page, fine inset border, binding edge, portrait on the left, records on the right, prose below. Below 260 pixels of available container width the portrait and records stack. Title and refresh placement intentionally differ from the initial concept at the user's direction.
- Color and assets: warm ivory, sepia text, brown corners and vermilion seal; the existing paper texture is reused. New mount asset: `pipicoc/assets/investigator-photo-mount.png`, generated using built-in ImageGen. Latest prompt preserved in the task: keep the blank paper/corners, enlarge the seal to about 55% of image width, pure-white exterior for CSS blending.
- Content: unchanged character facts; `1920s` is formatted as `1920`, while nonnumeric eras keep their projected term. Only the English `identityTitle` source is authored. A tool-enabled Pi presenter generated the Chinese seed caption; German and Arabic chrome projections are QA fixtures only. Their character prose is intentionally the English fixture, so these checks do not claim full campaign translation acceptance.
- Interactions: refresh increments the fixture's sheet read count, enters a disabled busy state and restores the rendered card. Host/renderer regressions verify art is requested once and retained across refreshes. No console warnings or errors were captured.
- Verification: 38 card component tests and 26 scoped host/UI-language tests passed; runtime build passed; compiled artwork is byte-identical to the source asset; `git diff --check` passed.

Preview: http://127.0.0.1:4186/ — actual component with fixture data, left open for review. Screenshots, presenter session and logs are retained under `.cache/passport-design/`.

## Seal correction after user review

The earlier replacement seal was **invalid-for-intent**: the user asked to enlarge
the selected seal, not redesign it or place it entirely on the photograph. Its
earlier visual approval is superseded for that area.

The asset now retains the original selected image byte-for-byte. CSS displays its
photo/seal region `(110,190,535,755)` and masks the surrounding rectangular paper,
preserving the original lettering, star, wear and photo-corner overlap. The seal
extends beyond the lower-right photo corner onto the document. No new stamp was
drawn. The other live text and language alignment are unchanged.

Latest evidence: `.cache/passport-design/identity-original-seal.png` (570 × 608),
inspected in the in-app browser at the same 375-pixel sidebar width. Original seal
and corrected rendered seal match in motif and overlap; the surrounding paper has
no rectangular image edge. Runtime rebuild, source/compiled asset byte comparison
and `git diff --check` passed. This remains component evidence, not App restart.

final result: passed

## Unified backplate after paper-colour review

The preceding cropped-photo/multiply treatment is **invalid-for-intent** for the
paper surface: it mixed two paper stocks and produced a visibly darker patch.
That area of the earlier pass is superseded.

The current asset is `pipicoc/assets/investigator-backplate.png`, a single
1289 × 1220 paper/frame/photo/seal backplate. Built-in ImageGen removed the live
text and interior rules from the selected concept while retaining the original
seal design and photo-corner composition. Only the ornamental seal lettering
remains in the bitmap. Names, captions, year and all character values stay in DOM.

CSS `border-image-slice: 950 55 55 70 fill` preserves the complete illustrated top
region. The remaining blank lower paper extends with content. No multiply blend,
photo mask, separate photo patch or second paper texture remains. The old asset
and its compiled copy are retained under `.cache/passport-design/` as superseded
evidence, not active package resources.

Evidence: `.cache/passport-design/identity-backplate.png` and
`.cache/passport-design/identity-backplate-narrow.png`, each 570 × 608 browser
pixels. Standard sidebar: 375 CSS pixels / 343-pixel card. Narrow sidebar:
220 / 188 pixels. Source and standard rendering were inspected together. Photo
and stamp keep their proportions, paper is continuous, and the language columns
remain aligned. German and Arabic title fixtures at 320-pixel sidebar width have
no horizontal overflow. Existing serif hierarchy and live text colours remain;
the frame, spine, ornament, photo corners and seal now come from the unified
artwork. No actionable P0/P1/P2 findings remain in this revised surface.

Reference practice checked against MDN's border-image-slice documentation and
W3C CSS Backgrounds and Borders Level 3. Card tests: 38 passed. Scoped host and
language checks: 26 passed. Runtime build and source/compiled backplate byte
comparison passed; browser console showed no warnings or errors. No App restart
or full campaign acceptance is claimed. Unrelated image-generation and launcher
work appeared concurrently near handoff and was not integrated by this task.

final result: passed
