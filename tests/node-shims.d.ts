// Minimal declarations for the Node built-ins the tests use (keeps @types/node out of the project).
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
}
declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(a: unknown, b: unknown, message?: string): void;
    deepEqual(a: unknown, b: unknown, message?: string): void;
  };
  export default assert;
}
