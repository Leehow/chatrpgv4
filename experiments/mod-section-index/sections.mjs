/** The cards' section text, cut from the live package files by block or heading, so the experiment reads the bytes a package ships. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;

export function loadCards(path = join(ROOT, 'experiments/mod-section-index/cards.json')) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  // A topics file (round 3) lists product-owned topics instead of package sections; each is a card with no text.
  const cards = parsed.cards ?? parsed.topics ?? parsed.sections;
  const files = new Map();
  const file = mod => {
    if (!files.has(mod)) files.set(mod, readFileSync(join(ROOT, 'mods', mod, 'agent.md'), 'utf8'));
    return files.get(mod);
  };
  return cards.map(card => ({...card, text: card.mod ? sectionText(file(card.mod), card) : ''}));
}

export function sectionText(markdown, card) {
  if (card.blocks) {
    const blocks = markdown.split(/\n[ \t]*\n/);
    return blocks.slice(card.blocks[0], card.blocks[1] + 1).join('\n\n').trim();
  }
  if (card.heading === 'start') {
    const at = markdown.indexOf('\n## ');
    return (at >= 0 ? markdown.slice(0, at) : markdown).replace(/^# .*\n/, '').trim();
  }
  const marker = `\n## ${card.heading}\n`, at = markdown.indexOf(marker);
  if (at < 0) throw new Error(`${card.mod}: no section "${card.heading}"`);
  const from = at + marker.length, next = markdown.indexOf('\n## ', from);
  return markdown.slice(from, next >= 0 ? next : undefined).trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const card of loadCards()) console.log(card.id.padEnd(16), card.trigger.padEnd(7), String(Buffer.byteLength(card.text)).padStart(5), 'B |', card.text.slice(0, 70).replace(/\n/g, ' '));
}
