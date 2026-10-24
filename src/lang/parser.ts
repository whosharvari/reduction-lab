/**
 * Recursive-descent parser: tokens -> AST.
 *
 * Grammar (lowest precedence first; see docs/LANGUAGE.md):
 *
 *   program     ::= expr EOF
 *   expr        ::= or
 *   or          ::= and ( '||' or )?                       right-assoc
 *   and         ::= compare ( '&&' and )?                  right-assoc
 *   compare     ::= additive ( CMP additive )?             non-assoc
 *   additive    ::= term ( ('+' | '-') term )*             left-assoc
 *   term        ::= unary ( ('*' | '/') unary )*           left-assoc
 *   unary       ::= '-' unary | prefix | application
 *   prefix      ::= 'let' IDENT IDENT* '=' expr 'in' expr
 *                 | '\' IDENT+ '->' expr
 *                 | 'if' expr 'then' expr 'else' expr
 *   application ::= atom atom*                             left-assoc
 *   atom        ::= NUMBER | 'True' | 'False' | IDENT
 *                 | '(' expr ')' | '[' ( expr ( ',' expr )* )? ']'
 *
 * `let`, lambda and `if` extend as far to the right as possible, as in Haskell.
 */
import {
  IdGenerator,
  type BinaryOperator,
  type ComparisonOperator,
  type Expr,
} from './ast';
import { syntaxError, type Span } from './errors';
import { tokenize, type Token, type TokenType } from './lexer';

const COMPARISON_OPERATORS: ReadonlySet<TokenType> = new Set<ComparisonOperator>([
  '==', '/=', '<', '<=', '>', '>=',
]);

const ATOM_START: ReadonlySet<TokenType> = new Set<TokenType>([
  'number', 'ident', 'True', 'False', '(', '[',
]);

export interface ParseOptions {
  /** Supply a generator to continue an existing id sequence. */
  readonly ids?: IdGenerator;
}

export function parse(source: string, options: ParseOptions = {}): Expr {
  return new Parser(tokenize(source), options.ids ?? new IdGenerator()).parseProgram();
}

function describe(token: Token): string {
  switch (token.type) {
    case 'eof':
      return 'end of input';
    case 'number':
      return `number ${token.text}`;
    case 'ident':
      return `identifier '${token.text}'`;
    default:
      return `'${token.text}'`;
  }
}

/** Span covering `from` through `to`. */
function join(from: Span, to: Span): Span {
  return { start: from.start, end: to.end, line: from.line, column: from.column };
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly ids: IdGenerator;

  constructor(tokens: Token[], ids: IdGenerator) {
    this.tokens = tokens;
    this.ids = ids;
  }

  parseProgram(): Expr {
    if (this.peek().type === 'eof') {
      throw syntaxError('Expected an expression but the program is empty', this.peek().span);
    }
    const expr = this.parseExpr();
    const next = this.peek();
    if (next.type !== 'eof') {
      throw syntaxError(`Unexpected ${describe(next)} after the end of the expression`, next.span);
    }
    return expr;
  }

  // ---- token helpers -------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private nextToken(): Token {
    const token = this.tokens[this.pos]!;
    if (token.type !== 'eof') this.pos++;
    return token;
  }

  private match(type: TokenType): Token | undefined {
    return this.peek().type === type ? this.nextToken() : undefined;
  }

  private expect(type: TokenType, context: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw syntaxError(`Expected '${type}' ${context}, but found ${describe(token)}`, token.span);
    }
    return this.nextToken();
  }

  private expectIdent(context: string): Token {
    const token = this.peek();
    if (token.type !== 'ident') {
      throw syntaxError(`Expected a variable name ${context}, but found ${describe(token)}`, token.span);
    }
    return this.nextToken();
  }

  private binary(op: BinaryOperator, left: Expr, right: Expr): Expr {
    return { kind: 'Binary', id: this.ids.next(), span: join(left.span, right.span), op, left, right };
  }

  // ---- grammar -------------------------------------------------------------

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    const left = this.parseAnd();
    if (!this.match('||')) return left;
    return this.binary('||', left, this.parseOr());
  }

  private parseAnd(): Expr {
    const left = this.parseCompare();
    if (!this.match('&&')) return left;
    return this.binary('&&', left, this.parseAnd());
  }

  private parseCompare(): Expr {
    const left = this.parseAdditive();
    const opToken = this.peek();
    if (!COMPARISON_OPERATORS.has(opToken.type)) return left;
    this.nextToken();
    const result = this.binary(opToken.type as ComparisonOperator, left, this.parseAdditive());
    const chained = this.peek();
    if (COMPARISON_OPERATORS.has(chained.type)) {
      throw syntaxError(
        `Comparison operators cannot be chained; add parentheses around one side of '${chained.text}'`,
        chained.span,
      );
    }
    return result;
  }

  private parseAdditive(): Expr {
    let left = this.parseTerm();
    for (;;) {
      const op = this.peek().type;
      if (op !== '+' && op !== '-') return left;
      this.nextToken();
      left = this.binary(op, left, this.parseTerm());
    }
  }

  private parseTerm(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek().type;
      if (op !== '*' && op !== '/') return left;
      this.nextToken();
      left = this.binary(op, left, this.parseUnary());
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    switch (token.type) {
      case '-': {
        this.nextToken();
        const operand = this.parseUnary();
        return { kind: 'Unary', id: this.ids.next(), span: join(token.span, operand.span), op: '-', operand };
      }
      case 'let':
        return this.parseLet();
      case '\\':
        return this.parseLambda();
      case 'if':
        return this.parseIf();
      default:
        return this.parseApplication();
    }
  }

  private parseLet(): Expr {
    const letToken = this.expect('let', 'to start a let expression');
    const name = this.expectIdent("after 'let'");
    // `let f x y = e in b` is sugar for `let f = \x -> \y -> e in b`.
    const params = this.parseParams([], name);
    this.expect('=', `after 'let ${name.text}'`);
    const value = this.wrapInLambdas(params, this.parseExpr());
    this.expect('in', `to finish the binding of '${name.text}'`);
    const body = this.parseExpr();
    return { kind: 'Let', id: this.ids.next(), span: join(letToken.span, body.span), name: name.text, value, body };
  }

  private parseLambda(): Expr {
    const slash = this.expect('\\', 'to start a lambda');
    const first = this.expectIdent("after '\\' (lambda parameter)");
    const params = this.parseParams([first]);
    this.expect('->', 'after the lambda parameters');
    const body = this.parseExpr();
    return this.wrapInLambdas(params, body, slash.span);
  }

  /** `initial` followed by zero or more identifiers; all names must be distinct. */
  private parseParams(initial: Token[], owner?: Token): Token[] {
    const params = [...initial];
    const seen = new Set(initial.map((t) => t.text));
    while (this.peek().type === 'ident') {
      const param = this.nextToken();
      if (seen.has(param.text)) {
        throw syntaxError(`Duplicate parameter '${param.text}'`, param.span);
      }
      if (owner && param.text === owner.text) {
        throw syntaxError(`Parameter '${param.text}' has the same name as the function being defined`, param.span);
      }
      seen.add(param.text);
      params.push(param);
    }
    return params;
  }

  /** Build `\p1 -> \p2 -> ... -> body`; the outermost span starts at `startSpan` if given. */
  private wrapInLambdas(params: Token[], body: Expr, startSpan?: Span): Expr {
    let result = body;
    for (let i = params.length - 1; i >= 0; i--) {
      const from = i === 0 && startSpan ? startSpan : params[i]!.span;
      result = { kind: 'Lambda', id: this.ids.next(), span: join(from, body.span), param: params[i]!.text, body: result };
    }
    return result;
  }

  private parseIf(): Expr {
    const ifToken = this.expect('if', 'to start a conditional');
    const cond = this.parseExpr();
    this.expect('then', "after the condition of 'if'");
    const thenBranch = this.parseExpr();
    this.expect('else', "after the 'then' branch (every 'if' needs an 'else')");
    const elseBranch = this.parseExpr();
    return { kind: 'If', id: this.ids.next(), span: join(ifToken.span, elseBranch.span), cond, thenBranch, elseBranch };
  }

  private parseApplication(): Expr {
    let fn = this.parseAtom();
    while (ATOM_START.has(this.peek().type)) {
      const arg = this.parseAtom();
      fn = { kind: 'App', id: this.ids.next(), span: join(fn.span, arg.span), fn, arg };
    }
    return fn;
  }

  private parseAtom(): Expr {
    const token = this.peek();
    switch (token.type) {
      case 'number':
        this.nextToken();
        return { kind: 'Number', id: this.ids.next(), span: token.span, value: Number(token.text) };
      case 'True':
      case 'False':
        this.nextToken();
        return { kind: 'Boolean', id: this.ids.next(), span: token.span, value: token.type === 'True' };
      case 'ident':
        this.nextToken();
        return { kind: 'Var', id: this.ids.next(), span: token.span, name: token.text };
      case '(': {
        this.nextToken();
        if (this.peek().type === ')') {
          throw syntaxError('Empty parentheses: expected an expression inside ( )', join(token.span, this.peek().span));
        }
        const inner = this.parseExpr();
        this.expect(')', `to close the '(' at ${token.span.line}:${token.span.column}`);
        // Parentheses only group; they do not create a node.
        return inner;
      }
      case '[':
        return this.parseList();
      default:
        throw syntaxError(`Expected an expression, but found ${describe(token)}`, token.span);
    }
  }

  private parseList(): Expr {
    const open = this.expect('[', 'to start a list');
    const elements: Expr[] = [];
    if (this.peek().type !== ']') {
      do {
        elements.push(this.parseExpr());
      } while (this.match(','));
    }
    const close = this.expect(']', `to close the list opened at ${open.span.line}:${open.span.column}`);
    return { kind: 'List', id: this.ids.next(), span: join(open.span, close.span), elements };
  }
}
