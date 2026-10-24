/**
 * Command-line runner:  npm run eval -- "map (\x -> x * 2) [1, 2, 3]"
 * With --ast, also prints the parsed tree as JSON.
 */
import { interpret, printExpr } from '../src/lang';

const args = process.argv.slice(2);
const showAst = args.includes('--ast');
const sources = args.filter((a) => a !== '--ast');

if (sources.length === 0) {
  console.error('usage: npm run eval -- [--ast] "<expression>" ["<expression>" ...]');
  process.exit(2);
}

let failed = false;
for (const source of sources) {
  const result = interpret(source);
  console.log(`> ${source}`);
  if (result.ast) {
    console.log(`  parsed: ${printExpr(result.ast)}`);
    if (showAst) console.log(JSON.stringify(result.ast, null, 2));
  }
  if (result.ok) {
    console.log(`  ${result.display}`);
  } else {
    failed = true;
    console.log(result.error.format(source).replace(/^/gm, '  '));
  }
}
process.exit(failed ? 1 : 0);
