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
  /**
   * Show at most this many characters (secondary previews). Only for views
   * without marks: clipping would cut highlighted ranges.
   */
  readonly maxChars?: number;
}

/** Prints a real AST with syntax colours and node-id based highlight marks. */
export const CodeView = memo(function CodeView({ expr, marks = [], className, label, maxChars }: CodeViewProps) {
  const marksKey = marks.map(([id, m]) => `${id}:${m}`).join(',');
  const segments = useMemo(() => {
    const { text, ranges } = printWithRanges(expr);
    if (maxChars !== undefined && text.length > maxChars) {
      return [...buildSegments(text.slice(0, maxChars), new Map(), []), { text: ' …', marks: [], token: 'comment' as const }];
    }
    return buildSegments(text, ranges, marks);
    // `marksKey` captures the content of `marks`, whose array identity changes every render.
  }, [expr, marksKey, maxChars]);
  const code = (
    <code className={`code ${className ?? ''}`}>
      <Segments segments={segments} />
    </code>
  );
  // ARIA prohibits naming a <code> element, so a label goes on a wrapping group.
  return label ? (
    <span role="group" aria-label={label} className="code-group">
      {code}
    </span>
  ) : (
    code
  );
});
