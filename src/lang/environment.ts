/**
 * Lexical environments: immutable, persistent linked frames.
 *
 * `extend` never mutates, so a closure that captured an environment keeps
 * seeing exactly the bindings that existed when it was created, regardless of
 * what is bound later. Shadowing is just a newer frame with the same name.
 */
import type { Value } from './values';

export class Environment {
  private readonly frame: { readonly name: string; readonly value: Value; readonly parent: Environment } | null;

  private constructor(frame: Environment['frame']) {
    this.frame = frame;
  }

  static empty(): Environment {
    return new Environment(null);
  }

  static from(bindings: Iterable<readonly [string, Value]>): Environment {
    let env = Environment.empty();
    for (const [name, value] of bindings) env = env.extend(name, value);
    return env;
  }

  extend(name: string, value: Value): Environment {
    return new Environment({ name, value, parent: this });
  }

  lookup(name: string): Value | undefined {
    for (let env: Environment = this; env.frame; env = env.frame.parent) {
      if (env.frame.name === name) return env.frame.value;
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  /** Visible bindings, innermost first, with shadowed names omitted. */
  entries(): Array<[string, Value]> {
    const seen = new Set<string>();
    const result: Array<[string, Value]> = [];
    for (let env: Environment = this; env.frame; env = env.frame.parent) {
      if (seen.has(env.frame.name)) continue;
      seen.add(env.frame.name);
      result.push([env.frame.name, env.frame.value]);
    }
    return result;
  }

  names(): string[] {
    return this.entries().map(([name]) => name);
  }
}
