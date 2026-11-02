import { createRequire } from 'node:module';

/**
 * `require` for optional dependencies (e.g. ioredis, pg) that are loaded lazily, only when the
 * feature that needs them is used, from synchronous code. The package is native ESM, so the
 * global `require` does not exist at runtime.
 */
export const optionalRequire: NodeRequire = createRequire(import.meta.url);
