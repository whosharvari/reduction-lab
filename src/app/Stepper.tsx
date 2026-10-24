/**
 * Step through a real reduction trace. Highlights:
 *  - the redex the next step will rewrite,
 *  - the sub-expression the previous step just produced,
 *  - the list element currently being updated.
 */
import { useEffect, useState } from 'react';
import { nodeAt, printWithRanges, stateAt, type Expr, type NodeId, type ReductionTrace } from '../lang';

type Mark = 'redex' | 'changed' | 'focus';

function focusElementId(expr: Expr, listPath: Parameters<typeof nodeAt>[1], index: number): NodeId | undefined {
  const list = nodeAt(expr, listPath);
  return list?.kind === 'List' ? list.elements[index]?.id : undefined;
}

function Highlighted({ expr, marks }: { expr: Expr; marks: ReadonlyArray<[NodeId | undefined, Mark]> }) {
  const { text, ranges } = printWithRanges(expr);
  const classes: string[][] = Array.from({ length: text.length }, () => []);
  for (const [id, mark] of marks) {
    const range = id === undefined ? undefined : ranges.get(id);
    if (!range) continue;
    for (let i = range.start; i < range.end; i++) classes[i]!.push(mark);
  }
  const segments: Array<{ text: string; className: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const className = classes[i]!.join(' ');
    const last = segments.at(-1);
    if (last && last.className === className) last.text += text[i];
    else segments.push({ text: text[i]!, className });
  }
  return (
    <code className="expr">
      {segments.map((s, i) => (s.className ? <span key={i} className={s.className}>{s.text}</span> : s.text))}
    </code>
  );
}

export function Stepper({ trace }: { trace: ReductionTrace }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [trace]);

  const total = trace.steps.length;
  const expr = stateAt(trace, index);
  const next = index < total ? trace.steps[index] : undefined;
  const previous = index > 0 ? trace.steps[index - 1] : undefined;
  const atEnd = index === total;
  const failed = atEnd && trace.outcome.status === 'error' ? trace.outcome : undefined;

  const focus = next?.listFocus ?? failed?.listFocus;
  const marks: Array<[NodeId | undefined, Mark]> = [
    [previous?.replacementId, 'changed'],
    [focus ? focusElementId(expr, focus.listPath, focus.index) : undefined, 'focus'],
    [next?.redexId ?? (failed?.path ? nodeAt(expr, failed.path)?.id : undefined), 'redex'],
  ];

  return (
    <section className="stepper" aria-label="Reduction steps">
      <div className="controls">
        <button type="button" onClick={() => setIndex(0)} disabled={index === 0}>⏮</button>
        <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0}>◀ Back</button>
        <button type="button" onClick={() => setIndex(index + 1)} disabled={atEnd}>Step ▶</button>
        <button type="button" onClick={() => setIndex(total)} disabled={atEnd}>⏭</button>
        <input
          type="range"
          min={0}
          max={total}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="Step"
        />
        <span className="counter">{index} / {total}</span>
      </div>

      <Highlighted expr={expr} marks={marks} />

      <p className="caption">
        {previous && <span className="done-caption">Did: {previous.description}. </span>}
        {next && <span>Next: {next.description}{next.listFocus ? ` (element ${next.listFocus.index})` : ''}</span>}
        {atEnd && trace.outcome.status === 'done' && <strong>Done: this is a value.</strong>}
        {failed && <strong className="error-text">Stuck: {failed.error.kind}: {failed.error.message}</strong>}
      </p>
    </section>
  );
}
