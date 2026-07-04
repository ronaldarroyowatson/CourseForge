export type Immutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<Immutable<U>>
    : T extends object
      ? { readonly [K in keyof T]: Immutable<T[K]> }
      : T;

export function deepFreeze<T>(value: T): Immutable<T> {
  if (value === null || typeof value !== "object") {
    return value as Immutable<T>;
  }

  const target = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(target)) {
    const nested = target[key];
    if (nested && typeof nested === "object") {
      deepFreeze(nested);
    }
  }

  return Object.freeze(value) as Immutable<T>;
}
