// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { EXAMPLES } from '../src/app/examples';
import { PLAY_INTERVAL_MS } from '../src/app/useExecution';
import { ExecutionController } from '../src/lang';

const button = (name: RegExp | string) => screen.getByRole('button', { name });
const expression = () => screen.getByLabelText('Expression being reduced').textContent;
const counter = () => screen.getByLabelText('Step counter').textContent?.replace(/\s+/g, ' ').trim();
const status = () => within(screen.getByRole('toolbar')).getByRole('status').textContent;
const editor = () => screen.getByLabelText('Program source') as HTMLTextAreaElement;
const chooseExample = (title: string) => {
  const match = screen.getAllByRole('button', { pressed: false }).concat(screen.getAllByRole('button', { pressed: true }))
    .find((b) => b.querySelector('.example-title')?.textContent === title);
  if (!match) throw new Error(`No example titled ${title}`);
  fireEvent.click(match);
};

/** The real reducer's states for `source`, for comparison with what the UI shows. */
function statesOf(source: string): string[] {
  const c = ExecutionController.fromSource(source);
  c.runToCompletion();
  return c.history.map((e) => e.source);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('first run', () => {
  it('loads the default example at the initial state with instructions', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Reduction Lab' })).toBeTruthy();
    expect(screen.getByText('Every expression has a story. Watch it unfold.')).toBeTruthy();
    expect(screen.getByLabelText('How to use Reduction Lab').textContent).toMatch(/Each Next step performs one real reduction/);
    expect(editor().value).toBe(EXAMPLES[0]!.source);
    expect(expression()).toBe('map (\\x -> x * 2) [1, 2, 3]');
    expect(counter()).toMatch(/^Step 0/);
    expect(status()).toBe('Ready');
  });

  it('the introduction can be dismissed and stays dismissed', () => {
    render(<App />);
    fireEvent.click(button('Dismiss introduction'));
    expect(screen.queryByLabelText('How to use Reduction Lab')).toBeNull();
    cleanup();
    render(<App />);
    expect(screen.queryByLabelText('How to use Reduction Lab')).toBeNull();
  });
});

describe('stepping through the real reducer', () => {
  const states = statesOf(EXAMPLES[0]!.source);

  it('Next performs exactly one reduction', () => {
    render(<App />);
    fireEvent.click(button(/Next step/));
    expect(expression()).toBe(states[1]);
    expect(counter()).toMatch(/^Step 1/);
    fireEvent.click(button(/Next step/));
    expect(expression()).toBe(states[2]);
  });

  it('Previous restores the earlier state', () => {
    render(<App />);
    fireEvent.click(button(/Next step/));
    fireEvent.click(button(/Next step/));
    fireEvent.click(button(/Previous/));
    expect(expression()).toBe(states[1]);
    expect(counter()).toMatch(/^Step 1/);
  });

  it('Reset returns to the initial expression', () => {
    render(<App />);
    for (let i = 0; i < 3; i++) fireEvent.click(button(/Next step/));
    fireEvent.click(button('Reset'));
    expect(expression()).toBe(states[0]);
    expect(counter()).toMatch(/^Step 0/);
    expect((button('Reset') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Run reaches the final value and disables forward controls', () => {
    render(<App />);
    fireEvent.click(button('Run to end'));
    expect(expression()).toBe('[2, 4, 6]');
    expect(screen.getByText('Final value')).toBeTruthy();
    expect(status()).toBe('Complete');
    expect(counter()).toBe(`Step ${states.length - 1} / ${states.length - 1}`);
    expect((button(/Next step/) as HTMLButtonElement).disabled).toBe(true);
    expect((button('Run to end') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Play') as HTMLButtonElement).disabled).toBe(true);
    expect((button(/Previous/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Play advances one real step per tick', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(button('Play'));
    expect(expression()).toBe(states[1]);
    expect(status()).toBe('Playing');
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS));
    expect(expression()).toBe(states[2]);
    fireEvent.click(button('Pause'));
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3));
    expect(expression()).toBe(states[2]);
  });

  it('keyboard shortcuts drive the same controller', () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(expression()).toBe(states[2]);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(expression()).toBe(states[1]);
    // Typing in the editor does not step.
    fireEvent.keyDown(editor(), { key: 'ArrowRight' });
    expect(expression()).toBe(states[1]);
  });

  it('clicking a history entry jumps to that state', () => {
    render(<App />);
    fireEvent.click(button('Run to end'));
    const history = screen.getByRole('list', { name: 'Recorded states' });
    fireEvent.click(within(history).getAllByRole('button')[3]!);
    expect(expression()).toBe(states[3]);
    expect(counter()).toMatch(/^Step 3/);
  });

  it('shows the rule explanation and the latest rewrite', () => {
    render(<App />);
    expect(screen.getByLabelText('Next step').textContent).toMatch(/Map expansion/);
    fireEvent.click(button(/Next step/));
    expect(screen.getByLabelText('Latest rewrite').textContent).toMatch(/Map expansion/);
    expect(screen.getByLabelText('Next step').textContent).toMatch(/β-reduction/);
  });
});

describe('list visualisations', () => {
  it('map highlights the element the next step rewrites', () => {
    render(<App />);
    const active = () => within(screen.getByRole('list', { name: 'Map elements' })).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    expect(active()).toBeUndefined(); // not expanded yet
    fireEvent.click(button(/Next step/)); // map expansion
    expect(active()?.getAttribute('aria-label')).toBe('Element 0: processing');
    fireEvent.click(button(/Next step/));
    fireEvent.click(button(/Next step/)); // element 0 is now 2
    expect(active()?.getAttribute('aria-label')).toBe('Element 1: processing');
    const cells = within(screen.getByRole('list', { name: 'Map elements' })).getAllByRole('listitem');
    expect(cells.map((c) => c.dataset.status)).toEqual(['done', 'active', 'pending']);
  });

  it('fold shows elements and accumulator from the real history', () => {
    render(<App />);
    chooseExample('Fold');
    const source = EXAMPLES.find((e) => e.id === 'fold')!.source;
    // Reference: the reducer's own metadata for state 5 (element 1 has just been consumed).
    const c = ExecutionController.fromSource(source);
    c.goTo(5);
    expect(c.current.step!.foldFocus).toMatchObject({ phase: 'consume', index: 1 });

    for (let i = 0; i < 5; i++) fireEvent.click(button(/Next step/));
    const cells = within(screen.getByRole('list', { name: 'Fold elements' })).getAllByRole('listitem');
    expect(cells.map((cell) => cell.dataset.status)).toEqual(['consumed', 'active', 'pending']);
    expect(screen.getByLabelText('Accumulator values so far').textContent).toBe('0→1');
    expect(screen.getByLabelText('Current accumulator').textContent).toBe('(\\acc -> \\x -> acc + x) 1 2');
    fireEvent.click(button('Run to end'));
    expect(screen.getByLabelText('Accumulator values so far').textContent).toBe('0→1→3→6');
  });
});

describe('errors and fresh histories', () => {
  it('runtime errors are shown without crashing and stop forward controls', () => {
    render(<App />);
    chooseExample('Runtime error');
    fireEvent.click(button('Run to end'));
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/RuntimeError.*Division by zero/);
    expect(status()).toBe('Stopped: error');
    expect((button(/Next step/) as HTMLButtonElement).disabled).toBe(true);
    expect((button(/Previous/) as HTMLButtonElement).disabled).toBe(false);
    const failed = within(screen.getByRole('list', { name: 'Map elements' })).getByLabelText(/failed/);
    expect(failed.getAttribute('aria-label')).toBe('Element 2: failed');
  });

  it('syntax errors are reported live and on restart without losing the editor text', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: '(\\x -> x * ) 2' } });
    expect(screen.getByRole('alert').textContent).toMatch(/SyntaxError at 1:12/);
    // The stepper keeps showing the last valid program until restarted.
    expect(expression()).toBe('map (\\x -> x * 2) [1, 2, 3]');
    fireEvent.click(button('Restart'));
    expect(status()).toBe('Syntax error');
    expect(editor().value).toBe('(\\x -> x * ) 2');
    fireEvent.change(editor(), { target: { value: '1 + 2' } });
    fireEvent.click(button('Restart'));
    expect(expression()).toBe('1 + 2');
  });

  it('Cmd/Ctrl+Enter loads the edited code into a fresh history', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: '2 * 21' } });
    expect(screen.getByText(/Code changed/)).toBeTruthy();
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    expect(expression()).toBe('2 * 21');
    fireEvent.click(button(/Next step/));
    expect(expression()).toBe('42');
  });

  it('changing examples creates a fresh history', () => {
    render(<App />);
    fireEvent.click(button('Run to end'));
    chooseExample('Let binding');
    expect(expression()).toBe('let x = 10 in x + 2');
    expect(counter()).toMatch(/^Step 0/);
    const rows = within(screen.getByRole('list', { name: 'Recorded states' })).getAllByRole('button');
    expect(rows[0]!.textContent).toMatch(/let x = 10 in x \+ 2/);
    expect(rows.length).toBeLessThanOrEqual(2); // initial state (+ at most the precomputed next one)
  });

  it('Reset to example restores the example source', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'oops' } });
    fireEvent.click(button('Reset to example'));
    expect(editor().value).toBe(EXAMPLES[0]!.source);
  });
});

describe('every example runs in the UI', () => {
  it.each(EXAMPLES)('$title', (example) => {
    render(<App />);
    chooseExample(example.title);
    fireEvent.click(button('Run to end'));
    if (example.expected === 'RuntimeError') {
      expect(status()).toBe('Stopped: error');
    } else {
      expect(expression()).toBe(example.expected);
      expect(status()).toBe('Complete');
    }
  });
});

describe('responsive layout', () => {
  // jsdom has no layout engine; the stylesheet must collapse the grid on small screens.
  const css = readFileSync(resolve(process.cwd(), 'src/app/styles.css'), 'utf8');

  it('collapses to a single column on narrow viewports', () => {
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('lets controls wrap and expressions break on phones', () => {
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.controls-group \{ width: 100%; \}/);
    expect(css).toMatch(/\.code \{[^}]*overflow-wrap: anywhere;/);
  });

  it('respects reduced-motion preferences', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
