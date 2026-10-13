/**
 * The machine tokens the kernel mints: the {{marker}} and {{say:...}} wrappers.
 * Literal syntax only; names may use any script and nothing here reads prose.
 */
const MECHANICS_MARKER = /\{\{[a-z0-9][a-z0-9:_-]*\}\}|\{\{say:[^{}\n]{1,60}\}\}|\{\{\/say\}\}/g;
/** The card also drops anything else left in braces, including non-ASCII marker names. */
const LOOSE_MARKER = /\{\{[^{}\n]*\}\}/g;

/** A delivery with its existing marker syntax removed, matching the public card's prose. */
export function withoutMechanicsMarkers(text) {
  return text.replace(MECHANICS_MARKER, '').replace(LOOSE_MARKER, '').replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
