# Jev visual navigation funnel

Owner approval: 2026-10-14. Scope: resized page collages, independent multi-page filtering, Box hints, and demand-driven long context. No package, source publication or gameplay authority changes.

## Intent and success

Find useful original PDF pages and regions with fewer redundant decisions while retaining uncertain leads. Success requires real source-image measurements of missed targets, geometry, latency and charged tokens. Passing transport tests or producing a report alone does not establish an improvement.

## Contract

- Keep existing text decisions pinned to jev-1.13.0. Visual decisions pin jev-1.14.0 and send TypeSafe-Danger-Zone-Images: true. No floating aliases.
- Each host-owned image appears once in state. Assets are JPEG/PNG, with validated dimensions and file bytes. Fit collages within 1568 pixels, preserving aspect ratio and recording padding and tile geometry. A visual token reservation uses the entire configured context limit because the vendor publishes no image tokenizer bound. Upload bytes are a separate limit.
- A 16-page collage narrows ambiguous judgments through four-page collages and single pages, skipping redundant stages for small inputs. Every tile gets its own Noul; several pages may survive. Scores at or below 0.1 leave the shortlist; 0.1 to 0.35 remains uncertain material for the original reader without paying for every magnification. Scores at least 0.35 but below 0.6 and missing judgments advance. A score at least 0.6 completes page identification when no Box is requested; when a Box is requested, that page skips intermediate reclassification and goes directly to single-page localization. These are provisional navigation thresholds, not source absence or completeness. Box needs existence at least 0.6. Valid geometry with confidence below 0.6 remains a tentative navigation proposal; it never becomes evidence or a publication permission. A location outside the original-page rectangle is withheld rather than widened or clamped.
- Single-page requests use the original page raster at its aspect ratio, without a printed host label or square collage padding. Only a side below the API minimum receives the necessary host padding, whose exact rectangle remains explicit. Original-page delivery still supplies the full page; a valid Box does not establish complete crop coverage.
- Host maps normalized Box coordinates through the actual rendered image/tile geometry to original-page coordinates. Padding, coordinate frame, original PDF hash, physical page and image hash remain explicit. No automatic widening or redaction decisions.
- The source reader uses the funnel for pages without usable navigation text and for visual asset crop hints. Existing visual scan readers receive advisory funnel hints but still inspect their full assigned overview. Existing original-page delivery and independent review gates remain authoritative.
- Page-lead text requests carry whole page navigation text, greedily grouping at most sixteen pages within ordinary packing limits. Flush an ordinary group before adding a page that would exceed those limits. A page that cannot fit ordinary context is isolated and may use the 262000-token header; other pages do not accompany it merely to fill long context. An individual page that cannot fit even long context remains explicitly unanswered; no invented absence or silent truncation.
- Cache identity includes the pinned models and policy version. Cancellation, bounded shared leases and failed-image fallback retain the original reader path. Telemetry keeps judgments, geometry, model and usage without credentials or image payloads.

## Three ends

The PDF host writes collages and their geometry; Jev writes typed navigation decisions. The source reader consumes retained pages and advisory regions. The existing tool-enabled author chooses what to read/crop and produces its checked submission; independent review and TypeScript publication gates remain the actors for source facts.

## External comparison

[TypeSafe image patterns](https://docs.typesafe.ai/images#patterns) support small-image screening and recursive tile search. [Box](https://docs.typesafe.ai/primitives/box) requires a separate existence question. [PyMuPDF region rendering](https://github.com/pymupdf/PyMuPDF/blob/main/docs/recipes-images.rst) independently confirms locating on a small raster and rendering a region from the original. This project keeps its existing PDF.js renderer; no new PDF dependency is introduced.

## Validation

Transport and deterministic tests cover absent targets, uncertain and failed batches, several retained pages, malformed boxes, padding transforms, cancellation, explicit long context and complete original text. Real PDF comparisons retain the input sheets, actual responses, region crops, model IDs, wall time and usage. Component measurements are not gameplay or packaged-App acceptance.

## Approved refinement after multi-corpus stress (2026-10-14)

The retained 117-page pilot found 29/29 human map pages in both arms, but the dense map pack needed 25 funnel calls versus 18 single-page calls. A one-pass collage prototype retained recognition but lost valid/complete boxes. Two Chinese text windows had lower explicit-fact scores in sixteen-page groups; identical-body header A/B did not reproduce that drop. The owner approved conditional refinement, original-aspect single-page localization and ordinary-context-first complete-text grouping. Do not raise absence thresholds, clamp invalid boxes, truncate text, or weaken the original author/review gates. Evidence: `.coc/experiments/jev-stress-20261014-multicorpus/report.md`.
