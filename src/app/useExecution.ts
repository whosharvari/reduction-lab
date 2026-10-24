/**
 * React binding for the (framework-independent) ExecutionController.
 *
 * The controller is mutable, so React never reads it during render. Every
 * action mutates it inside an event handler or timer, then publishes an
 * immutable `ExecutionView` (snapshot + copied history) into state.
 * Long runs advance in time-boxed batches between frames so the UI stays
 * responsive; a cancellation token stops any batch or autoplay as soon as
 * another action happens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExecutionController,
  isLangError,
  type ExecutionOptions,
  type ExecutionSnapshot,
  type HistoryEntry,
  type LangError,
} from '../lang';

export const EXECUTION_LIMITS: ExecutionOptions = { maxSteps: 5000, maxNodes: 20_000 };
const BATCH_MS = 12;
export const PLAY_INTERVAL_MS = 650;

interface Session {
  readonly id: number;
  readonly source: string;
  readonly controller?: ExecutionController;
  readonly parseError?: LangError;
}

export interface ExecutionView {
  readonly sessionId: number;
  /** The source this history was created from (may differ from the editor while editing). */
  readonly source: string;
  readonly parseError?: LangError;
  readonly snapshot?: ExecutionSnapshot;
  readonly history: readonly HistoryEntry[];
}

export type Activity = 'idle' | 'running' | 'playing';

function createSession(id: number, source: string): Session {
  try {
    return { id, source, controller: ExecutionController.fromSource(source, EXECUTION_LIMITS) };
  } catch (error) {
    if (isLangError(error)) return { id, source, parseError: error };
    throw error;
  }
}

function viewOf(session: Session): ExecutionView {
  const c = session.controller;
  return {
    sessionId: session.id,
    source: session.source,
    ...(session.parseError ? { parseError: session.parseError } : {}),
    ...(c ? { snapshot: c.snapshot(), history: c.history.slice() } : { history: [] }),
  };
}

export interface ExecutionActions {
  /** Fresh history for `source`, positioned at the initial state. */
  load(source: string): void;
  next(): void;
  previous(): void;
  reset(): void;
  goTo(index: number): void;
  /** Reduce to completion in responsive batches (optionally loading new source first). */
  run(source?: string): void;
  /** Step automatically at a readable pace until the end. */
  play(): void;
  pause(): void;
}

export function useExecution(initialSource: string): [ExecutionView, Activity, ExecutionActions] {
  const nextId = useRef(1);
  const [view, setView] = useState<ExecutionView>(() => viewOf(createSession(0, initialSource)));
  const session = useRef<Session | null>(null);
  const [activity, setActivity] = useState<Activity>('idle');
  const job = useRef<{ cancelled: boolean } | null>(null);

  // The initial session is created lazily on first use (StrictMode may run initialisers twice).
  const currentSession = (): Session => {
    session.current ??= createSession(0, view.source);
    return session.current;
  };

  const publish = useCallback(() => {
    if (session.current) setView(viewOf(session.current));
  }, []);

  const cancel = useCallback(() => {
    if (job.current) job.current.cancelled = true;
    job.current = null;
    setActivity('idle');
  }, []);

  useEffect(() => cancel, [cancel]);

  const withController = (action: (c: ExecutionController) => void) => {
    cancel();
    const c = currentSession().controller;
    if (!c) return;
    action(c);
    publish();
  };

  const load = (source: string) => {
    cancel();
    session.current = createSession(nextId.current++, source);
    publish();
  };

  const run = (source?: string) => {
    if (source !== undefined && source !== currentSession().source) load(source);
    cancel();
    const c = currentSession().controller;
    if (!c || !c.canGoForward) return;
    const token = { cancelled: false };
    job.current = token;
    setActivity('running');
    const tick = () => {
      if (token.cancelled) return;
      const started = performance.now();
      while (c.canGoForward && performance.now() - started < BATCH_MS) c.next();
      publish();
      if (c.canGoForward) {
        setTimeout(tick, 0);
      } else {
        job.current = null;
        setActivity('idle');
      }
    };
    tick();
  };

  const play = () => {
    cancel();
    const c = currentSession().controller;
    if (!c || !c.canGoForward) return;
    const token = { cancelled: false };
    job.current = token;
    setActivity('playing');
    const tick = () => {
      if (token.cancelled) return;
      c.next();
      publish();
      if (c.canGoForward) {
        setTimeout(tick, PLAY_INTERVAL_MS);
      } else {
        job.current = null;
        setActivity('idle');
      }
    };
    tick();
  };

  const actions: ExecutionActions = {
    load,
    next: () => withController((c) => c.next()),
    previous: () => withController((c) => c.previous()),
    reset: () => withController((c) => c.reset()),
    goTo: (index) => withController((c) => c.goTo(index)),
    run,
    play,
    pause: cancel,
  };

  return [view, activity, actions];
}
