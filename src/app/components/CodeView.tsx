import { memo, useMemo } from 'react';
import { printWithRanges, type Expr, type NodeId } from '../../lang';
import { buildSegments, type Mark, type Segment } from '../model/highlight';

export type MarkList = ReadonlyArray<readonly [NodeId | undefined, Mark]>;

export function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        const className = [s.token && `t-${s.token}`, ...s.marks.map((m) => `m-${m}`)].filter(Boolean).join(' ');
        return className ? (
          <span key={i} className={className}>
            {s.text}
          </span>
        ) : (
          s.text
        );
      })}
    </>
  );
}

interface CodeViewProps {
  readonly expr: Expr;
  readonly marks?: MarkList;
  readonly className?: string;
  readonly label?: string;
}

/** Prints a real AST with syntax colours and node-id based highlight marks. */
export const CodeView = memo(function CodeView({ expr, marks = [], className, label }: CodeViewProps) {
  const marksKey = marks.map(([id, m]) => `${id}:${m}`).join(',');
  const segments = useMemo(() => {
    const { text, ranges } = printWithRanges(expr);
    return buildSegments(text, ranges, marks);
    // `marksKey` captures the content of `marks`, whose array identity changes every render.
  }, [expr, marksKey]);
  return (
    <code className={`code ${className ?? ''}`} aria-label={label}>
      <Segments segments={segments} />
    </code>
  );
});
