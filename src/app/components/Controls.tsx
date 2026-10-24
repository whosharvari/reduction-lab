import type { ExecutionSnapshot } from '../../lang';
import type { Activity, ExecutionActions } from '../useExecution';

interface ControlsProps {
  readonly snapshot?: ExecutionSnapshot;
  readonly activity: Activity;
  readonly actions: ExecutionActions;
  /** Load the editor's code into a fresh history. */
  readonly onRestart: () => void;
  /** Run the editor's code to completion. */
  readonly onRun: () => void;
  readonly dirty: boolean;
  /** False when the edited code has a syntax error (Run would discard the current history). */
  readonly canRunEdited: boolean;
}

export function statusOf(snapshot: ExecutionSnapshot | undefined, activity: Activity) {
  if (!snapshot) return { label: 'Syntax error', tone: 'error' } as const;
  if (activity === 'running') return { label: 'Running…', tone: 'busy' } as const;
  if (activity === 'playing') return { label: 'Playing', tone: 'busy' } as const;
  if (snapshot.status === 'done') return { label: 'Complete', tone: 'done' } as const;
  if (snapshot.status === 'error') return { label: 'Stopped: error', tone: 'error' } as const;
  return { label: snapshot.index === 0 ? 'Ready' : 'Stepping', tone: 'idle' } as const;
}

export function Controls({ snapshot, activity, actions, onRestart, onRun, dirty, canRunEdited }: ControlsProps) {
  const busy = activity !== 'idle';
  const canBack = !!snapshot?.canGoBack;
  const canForward = !!snapshot?.canGoForward;
  const status = statusOf(snapshot, activity);
  const total = snapshot ? `${snapshot.knownSteps}${snapshot.finished ? '' : '+'}` : '–';

  return (
    <div className="controls" role="toolbar" aria-label="Execution controls">
      <div className="controls-group">
        <button type="button" className="btn btn-primary" onClick={actions.next} disabled={!canForward || busy} aria-keyshortcuts="ArrowRight">
          Next step <kbd>→</kbd>
        </button>
        <button type="button" className="btn" onClick={actions.previous} disabled={!canBack || busy} aria-keyshortcuts="ArrowLeft">
          <kbd>←</kbd> Previous
        </button>
        {activity === 'playing' ? (
          <button type="button" className="btn" onClick={actions.pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="btn" onClick={actions.play} disabled={!canForward || busy}>
            Play
          </button>
        )}
        {activity === 'running' ? (
          <button type="button" className="btn" onClick={actions.pause}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn" onClick={onRun} disabled={busy || !canRunEdited || (!canForward && !dirty)} aria-keyshortcuts="End">
            Run to end
          </button>
        )}
      </div>
      <div className="controls-group">
        <button type="button" className="btn btn-ghost" onClick={actions.reset} disabled={!snapshot || snapshot.index === 0} aria-keyshortcuts="Home">
          Reset
        </button>
        <button type="button" className="btn btn-ghost" onClick={onRestart} title="Discard history and start again from the editor's code">
          Restart
        </button>
        <span className="step-counter" aria-label="Step counter" aria-live="polite">
          Step <strong>{snapshot?.index ?? 0}</strong> / {total}
        </span>
        <span className={`status status-${status.tone}`} role="status">
          {status.label}
        </span>
      </div>
    </div>
  );
}
