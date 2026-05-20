export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E extends string>(error: E, message: string): Result<never, E> {
  return { ok: false, error, message };
}
