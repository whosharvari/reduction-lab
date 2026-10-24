/**
 * Command-line runner:  npm run eval -- "map (\x -> x * 2) [1, 2, 3]"
 * With --ast, also prints the parsed tree as JSON.
 * With --steps, also prints the small-step reduction trace.
 */
import { interpret, printExpr, traceReduction } from '../src/lang';

const args = process.argv.slice(2);
const showAst = args.includes('--ast');
const showSteps = args.includes('--steps');
const sources = args.filter((a) => a !== '--ast' && a !== '--steps');

if (sources.length === 0) {
  console.error('usage: npm run eval -- [--ast] [--steps] "<expression>" ["<expression>" ...]');
  process.exit(2);
}

let failed = false;
for (const source of sources) {
  const result = interpret(source);
  console.log(`> ${source}`);
  if (result.ast) {
    console.log(`  parsed: ${printExpr(result.ast)}`);
    if (showAst) console.log(JSON.stringify(result.ast, null, 2));
    if (showSteps) {
      const trace = traceReduction(result.ast);
      console.log(`  0. ${printExpr(trace.initial)}`);
      trace.steps.forEach((step, i) => {
        const focus = step.listFocus ? `  [element ${step.listFocus.index}]` : '';
        console.log(`  ${i + 1}. ${printExpr(step.after)}    -- [${step.rule}] ${step.description}${focus}`);
      });
      if (trace.outcome.status === 'error') console.log(`  !! ${trace.outcome.error.kind}: ${trace.outcome.error.message}`);
    }
  }
  if (result.ok) {
    console.log(`  ${result.display}`);
  } else {
    failed = true;
    console.log(result.error.format(source).replace(/^/gm, '  '));
  }
}
process.exit(failed ? 1 : 0);
