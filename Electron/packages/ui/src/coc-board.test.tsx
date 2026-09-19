// @vitest-environment jsdom
/**
 * The case board panel (contract §39.3): the maps this table has been shown, the clues it has
 * found, and the people it has met -- the two sections that moved here from the investigator
 * sheet, plus the maps only the board carries.
 *
 * The panel reads one `board` answer, so every test here drives it the way `coc-panel.test.tsx`
 * drives the sheet: one fake `api`, one answer per case. The words come from the shipped surface
 * files, not from transcriptions -- the shared fixture (`coc-ui-words.ts`) does not carry the
 * board surface and is not edited from a test, so the two surfaces the board reads are imported
 * straight from `content/ui/`.
 */
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
// @ts-expect-error -- plain ESM pack asset, no type declarations
import { createComponent } from '../../../../pipicoc/board.js';
import enBoard from '../../../../content/ui/en/board.json';
import enErrors from '../../../../content/ui/en/errors.json';
import zhBoard from '../../../../content/ui/zh-Hans/board.json';
import zhErrors from '../../../../content/ui/zh-Hans/errors.json';

const Board = createComponent(React);
afterEach(cleanup);

/** The window-wide slot table the renderers share (§40.4). Nothing persists it, so a test clears
 *  it exactly the way a reload does, which is what keeps a slot assertion deterministic. */
const SLOT_TABLE = '__pipicocSpeakerSlots1';
beforeEach(() => { delete (globalThis as Record<string, unknown>)[SLOT_TABLE]; });

/** The two surfaces the board reads, in the language the answer names. */
const words = (tag: 'en' | 'zh-Hans') => ({
  board: tag === 'en' ? enBoard : zhBoard,
  errors: tag === 'en' ? enErrors : zhErrors,
});

/** A ready answer over an empty table: no maps, nothing found, nobody met. */
function ready(over: { view?: Record<string, unknown>; maps?: unknown[]; tag?: 'en' | 'zh-Hans' } = {}) {
  const tag = over.tag ?? 'en';
  return { ok: true, data: {
    status: 'ready', campaign: 'c1', ui: { tag, words: words(tag) },
    view: { play_language: tag, turn: 5, state: 'awaiting_player', investigators: [],
      clues: { discovered: [] }, npcs: { journal: [] }, labels: {}, ...over.view },
    maps: over.maps ?? [],
  } };
}

/** One `invoke` that answers `board` with whatever the test hands it, in order. */
function host(...answers: unknown[]) {
  const invoke = vi.fn(async () => answers[Math.min(invoke.mock.calls.length, answers.length) - 1]);
  return { invoke };
}

describe('a known map is the picture already in hand', () => {
  const house = {
    map: 'corbitt-house', name: 'Corbitt House', label: 'The Corbitt House', document: 'ready',
    image: 'data:image/png;base64,AA==',
    level_images: [
      { level: 'Ground floor', image: 'data:image/png;base64,AA==' },
      { level: 'Attic', image: 'data:image/png;base64,Ag==' },
    ],
    regions: [
      { id: 'parlour', label: 'The parlour', level: 'Ground floor' },
      { id: 'attic-room', label: 'The attic room', level: 'Attic' },
    ],
    levels: ['Ground floor', 'Attic'],
  };

  it('draws the page with floor buttons, a zoom named by the map, and the known regions', async () => {
    const api = host(ready({ maps: [house] }));
    const { container } = render(<Board api={api} />);
    await screen.findByRole('heading', { name: enBoard.maps });
    // Ready offers refresh; only a failure offers retry.
    expect(screen.getByRole('button', { name: enBoard.refresh })).toBeTruthy();
    expect(screen.queryByRole('button', { name: enBoard.retry })).toBeNull();
    expect(container.querySelector('img.coc-map-image')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    // Both floors are buttons; the ground floor is the one showing.
    expect(screen.getByRole('button', { name: 'Ground floor' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Attic' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Attic' }));
    await waitFor(() => expect(container.querySelector('img.coc-map-image')?.getAttribute('src')).toBe('data:image/png;base64,Ag=='));
    expect(screen.getByRole('button', { name: 'Attic' }).getAttribute('aria-pressed')).toBe('true');
    // The slider is named by the map it scales, and the scale is the image width.
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-label')).toBe('The Corbitt House');
    fireEvent.change(slider, { target: { value: '180' } });
    expect((container.querySelector('img.coc-map-image') as HTMLElement).style.width).toBe('180%');
    // The regions the table knows, on one line between middots.
    expect(container.querySelector('.coc-map-regions')?.textContent).toBe('The parlour · The attic room');
    // Refresh asks the pack again, with the same word a lane retry takes.
    fireEvent.click(screen.getByRole('button', { name: enBoard.refresh }));
    await waitFor(() => expect(api.invoke).toHaveBeenLastCalledWith('board', { retry_projection: true }));
  });

  it('names a map with no page, hangs no image anywhere, and still shows the regions', async () => {
    const { container } = render(<Board api={host(ready({
      tag: 'zh-Hans',
      maps: [
        { map: 'old-town', name: 'Old Town', label: 'Old Town', document: 'none',
          regions: [{ id: 'wharf', label: 'The wharf', level: 'ground' }, { id: 'mill', label: 'The mill', level: 'ground' }] },
        { map: 'mill-attic', name: 'Mill attic', document: 'none', regions: [] },
      ],
    }))} />);
    await screen.findByRole('heading', { name: zhBoard.maps });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    // The places the player knows are still true without the pixels; a pageless map with no
    // regions at all says so in the table's own words.
    const notes = container.querySelectorAll('.coc-map-empty');
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toBe('The wharf · The mill');
    expect(notes[1].textContent).toBe(zhBoard.mapUnavailable);
  });
});

describe('a found clue is named, and the account of how folds away', () => {
  it('renders the name, folds the account into a details, and keeps a bare clue a plain row', async () => {
    const how = 'Knott commissioned the party at Corbitt House in person.';
    const { container } = render(<Board api={host(ready({ view: {
      clues: { discovered: [
        { clue: 'knott-commission', label: "Knott's commission", how },
        { clue: 'bare-clue', label: 'A bare note' },
      ] },
      // The account is the Keeper's own prose from the table; the glossary never rewrites it.
      labels: { [how]: 'a glossary rewrite that must not happen' },
    } }))} />);
    await screen.findByRole('heading', { name: enBoard.clues });
    expect(screen.getByText("Knott's commission")).toBeTruthy();
    const folds = container.querySelectorAll('details.coc-clue-fold');
    expect(folds).toHaveLength(1);
    const fold = folds[0] as HTMLDetailsElement;
    // The name stays on the line; the account is one tap away and arrives verbatim.
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')?.textContent).not.toContain('Corbitt House');
    expect(fold.querySelector('.coc-clue-body')?.textContent).toBe(how);
    fireEvent.click(fold.querySelector('summary')!);
    expect(fold.open).toBe(true);
    // A clue under a bare name has nothing to open into.
    expect(screen.getByText('A bare note').closest('details')).toBeNull();
    expect(screen.getByText('A bare note').closest('.coc-clue')).toBeTruthy();
  });
});

describe('the people section is the legend for the spoken lines', () => {
  it('draws the speaker dot with its slot ink, and marks a closed ledger dead', async () => {
    const { container } = render(<Board api={host(ready({ view: {
      npcs: { journal: [
        { id: 'jackson-elias', name: 'Jackson Elias', description: 'An author of the expedition.',
          dead_since_turn: null, exchanges: [{ turn: 3, scene: "Knott's Office", summary: 'Asked about the expedition.' }] },
        { id: 'old-miller', name: 'Silas Miller', description: '', dead_since_turn: 7, exchanges: [] },
      ] },
      labels: { "Knott's Office": 'The office' },
    } }))} />);
    await screen.findByText('Jackson Elias');
    const rows = container.querySelectorAll('details.coc-clue-fold');
    expect(rows).toHaveLength(2);
    // The anchor-to-slot allocation is the delivery card's own (§40.4): on a fresh table,
    // 'jackson-elias' owns slot 11 -- the slot the speech test pins for the same handle.
    const dots = container.querySelectorAll('span.coc-say-dot');
    expect(dots).toHaveLength(2);
    expect((dots[0] as HTMLElement).style.getPropertyValue('--coc-say-ink')).toBe('var(--coc-say-11)');
    expect((dots[1] as HTMLElement).style.getPropertyValue('--coc-say-ink')).toMatch(/^var\(--coc-say-\d+\)$/);
    expect((dots[1] as HTMLElement).style.getPropertyValue('--coc-say-ink')).not.toBe('var(--coc-say-11)');
    // The dead mark rests next to the name of the one whose ledger closed.
    expect(rows[0].getAttribute('data-dead')).toBeNull();
    expect(rows[1].getAttribute('data-dead')).toBe('1');
    expect(rows[1].querySelector('.coc-npc-dead')).toBeTruthy();
    // The scene stamped on an exchange goes through the glossary; the journal's own prose does not.
    expect(rows[0].querySelector('.coc-npc-exchange-scene')?.textContent).toBe('The office');
    expect(rows[0].textContent).toContain('An author of the expedition.');
    expect(rows[0].textContent).toContain('Asked about the expedition.');
  });
});

describe('the answers that are not a table', () => {
  it('says there is no campaign in the shipped words, and offers retry', async () => {
    const api = host({ ok: true, data: { status: 'unbound', campaign: null,
      code: 'campaign_not_open', reason: 'no campaign on this session',
      ui: { tag: 'en', words: words('en') }, view: null, maps: [] } });
    render(<Board api={api} />);
    await screen.findByRole('heading', { name: enBoard.unboundTitle });
    expect(screen.getByRole('status').textContent).toBe(enBoard.unboundDetail);
    expect(screen.queryByRole('button', { name: enBoard.refresh })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: enBoard.retry }));
    await waitFor(() => expect(api.invoke).toHaveBeenLastCalledWith('board', { retry_projection: true }));
  });

  it('captions a failed read by its code, folds the English reason away, and offers retry', async () => {
    render(<Board api={host({ ok: true, data: { status: 'error', campaign: 'c1',
      code: 'kernel_error', reason: 'the kernel refused the read',
      ui: { tag: 'zh-Hans', words: words('zh-Hans') }, view: null, maps: [] } })} />);
    await screen.findByRole('heading', { name: zhBoard.errorTitle });
    expect(screen.getByRole('status').textContent).toBe(zhErrors.kernel_error);
    expect(screen.getByRole('status').textContent).not.toContain('the kernel refused');
    const fold = screen.getByText('the kernel refused the read').closest('details');
    expect(fold?.querySelector('summary')?.textContent).toBe(zhErrors.details);
    expect(screen.getByRole('button', { name: zhBoard.retry })).toBeTruthy();
    expect(screen.queryByRole('button', { name: zhBoard.refresh })).toBeNull();
  });

  it('falls back to the generic caption for a code no language carries', async () => {
    render(<Board api={host({ ok: true, data: { status: 'error', campaign: 'c1',
      code: 'a_code_from_a_later_kernel', reason: 'something new',
      ui: { tag: 'en', words: words('en') }, view: null, maps: [] } })} />);
    await screen.findByRole('heading', { name: enBoard.errorTitle });
    expect(screen.getByRole('status').textContent).toBe(enErrors.unknown);
  });
});

describe('module-authored names go through the glossary the answer carries', () => {
  it('projects a clue label, a journal name and a map title', async () => {
    const { container } = render(<Board api={host(ready({
      view: {
        clues: { discovered: [{ clue: 'blood-pool-manifest', label: 'Pools of blood' }] },
        npcs: { journal: [{ id: 'steven-knott', name: 'Steven Knott', description: '', dead_since_turn: null, exchanges: [] }] },
        labels: { 'Pools of blood': 'The blood pooled', 'Steven Knott': 'Mr. Knott', 'The Old Parlour': 'The parlour' },
      },
      maps: [{ map: 'ground-parlour', name: 'Ground parlour', label: 'The Old Parlour', document: 'none', regions: [] }],
    }))} />);
    await screen.findByText('The blood pooled');
    expect(screen.queryByText('Pools of blood')).toBeNull();
    expect(screen.getByText('Mr. Knott')).toBeTruthy();
    expect(screen.queryByText('Steven Knott')).toBeNull();
    expect(container.querySelector('.coc-map-name')?.textContent).toBe('The parlour');
  });
});
