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
  runtimeError,
  type ExecutionOptions,
  type ExecutionSnapshot,
  type HistoryEntry,
  type LangError,
} from '../lang';

export const EXECUTION_LIMITS: ExecutionOptions = { maxSteps: 5000, maxNodes: 20_000 };
const BATCH_MS = 12;
/** During Run, re-render at most this often (the final state is always published). */
const RUN_PUBLISH_MS = 80;
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

/** A running batch/autoplay loop. Cancelling clears its pending timer. */
interface Job {
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function createSession(id: number, source: string): Session {
  try {
    return { id, source, controller: ExecutionController.fromSource(source, EXECUTION_LIMITS) };
  } catch (error) {
    if (isLangError(error)) return { id, source, parseError: error };
    // Never let an unexpected engine failure take down the whole UI.
    return { id, source, parseError: runtimeError(`Internal error: ${error instanceof Error ? error.message : String(error)}`) };
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
  const job = useRef<Job | null>(null);

  // The initial session is created lazily on first use (StrictMode may run initialisers twice).
  const currentSession = (): Session => {
    session.current ??= createSession(0, view.source);
    return session.current;
  };

  const publish = useCallback(() => {
    if (session.current) setView(viewOf(session.current));
  }, []);

  const cancel = useCallback(() => {
    const running = job.current;
    if (running) {
      running.cancelled = true;
      clearTimeout(running.timer);
    }
    job.current = null;
    setActivity('idle');
    // Run publishes at most every RUN_PUBLISH_MS, so the controller may be ahead of
    // the screen: show where it really stopped before anything else happens.
    if (running) publish();
  }, [publish]);

  useEffect(() => cancel, [cancel]);

  const finish = (token: Job) => {
    if (job.current === token) job.current = null;
    setActivity('idle');
  };

  /** Skip cancelled ticks, and never leave the UI stuck in "running" if a tick throws. */
  const guarded = (token: Job, body: () => void) => () => {
    if (token.cancelled) return;
    try {
      body();
    } catch (error) {
      finish(token);
      publish();
      throw error;
    }
  };

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
    const token: Job = { cancelled: false };
    job.current = token;
    setActivity('running');
    let lastPublish = performance.now();
    const tick = guarded(token, () => {
      const started = performance.now();
      while (c.canGoForward && performance.now() - started < BATCH_MS) c.next();
      if (!c.canGoForward || performance.now() - lastPublish >= RUN_PUBLISH_MS) {
        publish();
        lastPublish = performance.now();
      }
      if (c.canGoForward) {
        token.timer = setTimeout(tick, 0);
      } else {
        finish(token);
      }
    });
    tick();
  };

  const play = () => {
    cancel();
    const c = currentSession().controller;
    if (!c || !c.canGoForward) return;
    const token: Job = { cancelled: false };
    job.current = token;
    setActivity('playing');
    const tick = guarded(token, () => {
      c.next();
      publish();
      if (c.canGoForward) {
        token.timer = setTimeout(tick, PLAY_INTERVAL_MS);
      } else {
        finish(token);
      }
    });
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
