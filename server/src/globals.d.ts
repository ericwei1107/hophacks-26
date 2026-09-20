/** The module host provides `console.log`, but `spacetimedb/server` doesn't declare it as ambient. */
declare const console: { log(...args: unknown[]): void };
