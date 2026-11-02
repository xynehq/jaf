import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Root of the compiled package (src/ or dist/): this file lives in <root>/utils/.
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const withoutExtension = (file: string): string => file.replace(/\.(c|m)?(j|t)s$/, '');

const resolveEntry = (entry: string): string => {
  try {
    return realpathSync(entry);
  } catch {
    return path.resolve(entry);
  }
};

/**
 * True when the current process was started with the given module as its entry point
 * (`node dist/<relPath>.js` or `tsx src/<relPath>.ts`). ESM replacement for
 * `require.main === module` in runnable examples; `relPath` is relative to the package root,
 * e.g. `'visualization/example'`.
 */
export const isMainScript = (relPath: string): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return withoutExtension(resolveEntry(entry)) === withoutExtension(path.join(packageRoot, relPath));
};
