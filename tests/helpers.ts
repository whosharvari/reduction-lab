import { expect } from 'vitest';
import { LangError, run, toJS, type ErrorKind } from '../src/lang';

/** Parse + evaluate real source and return plain JS data. */
export function evalJS(source: string): unknown {
  return toJS(run(source));
}

/** Assert that running `source` fails with the given error kind; returns the error. */
export function expectError(source: string, kind: ErrorKind, message?: RegExp): LangError {
  let caught: unknown;
  try {
    run(source);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${kind} for: ${source}`).toBeInstanceOf(LangError);
  const error = caught as LangError;
  expect(error.kind).toBe(kind);
  if (message) expect(error.message).toMatch(message);
  return error;
}
