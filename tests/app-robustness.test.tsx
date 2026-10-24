// @vitest-environment jsdom
/** Phase 4 audit: UI robustness regressions (timers, races, limits, invalid input, accessibility). */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { EXAMPLES } from '../src/app/examples';
import { PLAY_INTERVAL_MS } from '../src/app/useExecution';
import { ExecutionController } from '../src/lang';

const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const expression = () => screen.getByLabelText('Expression being reduced').textContent;
const counter = () => screen.getByLabelText('Step counter').textContent?.replace(/\s+/g, ' ').trim();
const status = () => within(screen.getByRole('toolbar')).getByRole('status').textContent;
const editor = () => screen.getByLabelText('Program source') as HTMLTextAreaElement;
const chooseExample = (title: string) => {
  const match = screen.getAllByRole('button').find((b) => b.querySelector('.example-title')?.textContent === title);
  fireEvent.click(match!);
};
const statesOf = (source: string) => {
  const c = ExecutionController.fromSource(source);
  c.runToCompletion();
  return c.history.map((e) => e.source);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('timers stop when they should', () => {
  // Regression: cancelled loops used to leave a pending timer that fired once more.
  it('Pause clears the pending autoplay timer', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(button('Play'));
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(button('Pause'));
    expect(vi.getTimerCount()).toBe(0);
    expect(status()).not.toBe('Playing');
  });

  it('Reset during playback stops it at the initial state', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(button('Play'));
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS));
    fireEvent.click(button('Reset'));
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS * 5));
    expect(counter()).toMatch(/^Step 0/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('switching examples during playback stops playback and starts a fresh history', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(button('Play'));
    chooseExample('Let binding');
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS * 5));
    expect(expression()).toBe('let x = 10 in x + 2');
    expect(counter()).toMatch(/^Step 0/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('manual stepping during playback takes over without double-stepping', () => {
    vi.useFakeTimers();
    render(<App />);
    const states = statesOf(EXAMPLES[0]!.source);
    fireEvent.click(button('Play')); // state 1
    fireEvent.keyDown(document.body, { key: 'ArrowRight' }); // state 2, cancels playback
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS * 5));
    expect(expression()).toBe(states[2]);
  });

  it('unmounting during playback leaves no timers behind', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(button('Play'));
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('rapid input', () => {
  it('many fast Next clicks advance exactly one real step each and stop at the end', () => {
    render(<App />);
    const states = statesOf(EXAMPLES[0]!.source);
    for (let i = 0; i < 50; i++) fireEvent.click(button(/Next step/));
    expect(expression()).toBe(states.at(-1));
    expect(counter()).toBe(`Step ${states.length - 1} / ${states.length - 1}`);
    for (let i = 0; i < 50; i++) fireEvent.click(button(/Previous/));
    expect(expression()).toBe(states[0]);
  });
});

describe('invalid and extreme input', () => {
  it('empty editor content is a clear syntax error, not a crash', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: '   ' } });
    expect(screen.getByRole('alert').textContent).toMatch(/program is empty/);
    fireEvent.click(button('Restart'));
    expect(status()).toBe('Syntax error');
  });

  it('pasting extremely nested code reports an error instead of crashing the app', () => {
    // Regression: the parser threw RangeError, which escaped React rendering.
    render(<App />);
    fireEvent.change(editor(), { target: { value: '('.repeat(5000) + '1' + ')'.repeat(5000) } });
    expect(screen.getByRole('alert').textContent).toMatch(/nested too deeply/);
    expect(expression()).toBe(EXAMPLES[0]!.source); // the current run is untouched
  });

  it('Run is disabled for edited code with a syntax error, so the current history is kept', () => {
    // Regression: Run/End loaded the broken code and discarded a valid history.
    render(<App />);
    fireEvent.click(button(/Next step/));
    fireEvent.change(editor(), { target: { value: 'map (\\x -> ' } });
    expect(button('Run to end').disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(counter()).toMatch(/^Step 1/);
    expect(status()).toBe('Stepping');
  });

  it('a long Run can be stopped part-way, keeping the steps computed so far', async () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: '(\\x -> x x) (\\x -> x x)' } });
    fireEvent.click(button('Run to end'));
    expect(status()).toBe('Running…');
    fireEvent.click(button('Stop'));
    expect(status()).not.toBe('Running…');
    const stoppedAt = counter();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(counter()).toBe(stoppedAt); // no further batches ran
    expect(button(/Next step/).disabled).toBe(false);
  });

  it('after Stop, the screen shows where the controller really is, so Next advances exactly one step', () => {
    // Regression: Run publishes at most every 80 ms; Stop did not publish, so the view lagged
    // the controller and the next Next jumped several steps at once.
    // With fake timers only Run's first (synchronous, ~12 ms) batch executes, and it is too
    // short to publish — so without the fix the screen is guaranteed to be behind.
    // (Only timers are faked: the batch is time-boxed with the real performance.now().)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = `fold (\\a -> \\x -> [a, x]) [] [${Array(400).fill('1').join(', ')}]`;
    const reference = statesOf(source);
    render(<App />);
    fireEvent.change(editor(), { target: { value: source } });
    fireEvent.click(button('Run to end'));
    expect(status()).toBe('Running…');
    fireEvent.click(button('Stop'));
    const shown = Number(counter()!.match(/^Step (\d+)/)![1]);
    expect(shown).toBeGreaterThan(0);
    expect(expression()).toBe(reference[shown]);
    fireEvent.click(button(/Next step/));
    expect(counter()).toMatch(new RegExp(`^Step ${shown + 1} `));
    expect(expression()).toBe(reference[shown + 1]);
  }, 20_000);

  it('a divergent program stops at the step limit with an understandable message', async () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: '(\\x -> x x) (\\x -> x x)' } });
    fireEvent.click(button('Run to end'));
    await waitFor(() => expect(status()).toBe('Stopped: error'), { timeout: 15_000 });
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent).join(' ');
    expect(alerts).toMatch(/did not finish within 5000 steps \(possible infinite loop\)/);
    expect(button(/Next step/).disabled).toBe(true);
    expect(button(/Previous/).disabled).toBe(false);
  }, 20_000);

  it('a reduction that grows too deep stops safely in the UI', async () => {
    render(<App />);
    // Each element adds five levels of nesting, so the depth limit is reached after ~200 elements.
    const elements = Array(300).fill('1').join(', ');
    fireEvent.change(editor(), { target: { value: `fold (\\a -> \\x -> [[[[[a, x]]]]]) [] [${elements}]` } });
    fireEvent.click(button('Run to end'));
    await waitFor(() => expect(status()).toBe('Stopped: error'), { timeout: 15_000 });
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/grew deeper than 1000 levels/);
  }, 20_000);
});

describe('state stays consistent when navigating', () => {
  it('stepping back and forward restores expression, inspector and visualisation together', () => {
    render(<App />);
    chooseExample('Fold');
    const snapshot = () => ({
      expr: expression(),
      inspector: screen.getByLabelText('Next step').textContent,
      cells: within(screen.getByRole('list', { name: 'Fold elements' }))
        .getAllByRole('listitem')
        .map((li) => li.dataset.status)
        .join(),
      acc: screen.getByLabelText('Current accumulator').textContent,
    });
    for (let i = 0; i < 6; i++) fireEvent.click(button(/Next step/));
    const atSix = snapshot();
    for (let i = 0; i < 3; i++) fireEvent.click(button(/Previous/));
    expect(snapshot()).not.toEqual(atSix);
    for (let i = 0; i < 3; i++) fireEvent.click(button(/Next step/));
    expect(snapshot()).toEqual(atSix);
    // And jumping via history lands on the same state too.
    fireEvent.click(button('Reset'));
    fireEvent.click(within(screen.getByRole('list', { name: 'Recorded states' })).getAllByRole('button')[6]!);
    expect(snapshot()).toEqual(atSix);
  });

  it('nested map: once the inner map finishes, the view follows the outer list', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'map (\\xs -> map (\\x -> x * 10) xs) [[1], [2]]' } });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
    fireEvent.click(button('Run to end')); // discover the whole history so every entry is clickable
    const c = ExecutionController.fromSource('map (\\xs -> map (\\x -> x * 10) xs) [[1], [2]]');
    c.runToCompletion();
    // First state where element 0 is finished ([10]) and element 1 is still pending.
    const target = c.history.findIndex((e) => e.source.startsWith('[[10], (\\xs'));
    expect(target).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('list', { name: 'Recorded states' })).getAllByRole('button')[target]!);
    const cells = within(screen.getByRole('list', { name: 'Map elements' })).getAllByRole('listitem');
    expect(cells).toHaveLength(2);
    expect(cells.map((li) => li.dataset.status)).toEqual(['done', 'active']);
  });
});

describe('accessibility', () => {
  it('visualisation tabs are wired to their tab panel', () => {
    render(<App />);
    const panel = screen.getByRole('tabpanel');
    const [lists, tree] = screen.getAllByRole('tab');
    expect(lists!.getAttribute('aria-controls')).toBe(panel.id);
    fireEvent.click(tree!);
    expect(tree!.getAttribute('aria-selected')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe(tree!.id);
    expect(screen.getByRole('list', { name: 'Syntax tree' })).toBeTruthy();
  });

  it('labelled code is exposed as a named group (names on <code> are not allowed)', () => {
    render(<App />);
    const group = screen.getByRole('group', { name: 'Expression being reduced' });
    expect(group.querySelector('code')?.getAttribute('aria-label')).toBeNull();
  });

  it('example buttons have readable names', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Map (map)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Map, then fold (composition)' })).toBeTruthy();
  });

  it('every button has an accessible name', () => {
    render(<App />);
    for (const b of screen.getAllByRole('button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
  });
});
