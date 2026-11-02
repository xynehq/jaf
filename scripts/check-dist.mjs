// Loads every package.json `exports` entry from dist/ with plain Node, through both the
// `import` and the `require` condition, and checks the root exposes the key public symbols.
// Run after `pnpm build`. Exits non-zero on any failure.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);

const REQUIRED_ROOT_EXPORTS = [
  'createJAFServer',
  'discoverRemoteTools',
  'jsonSchemaToZod',
  'zodSchemaToJsonSchema',
  'ensureOtelReady',
  'createOpenTelemetryTraceCollector',
  'shutdownOpenTelemetry',
];

const failures = [];

for (const [subpath, conditions] of Object.entries(pkg.exports)) {
  for (const condition of ['import', 'require']) {
    const target = conditions[condition];
    if (!target) continue;
    const file = path.join(root, target);
    try {
      const mod = condition === 'import' ? await import(pathToFileURL(file).href) : require(file);
      if (subpath === '.') {
        const missing = REQUIRED_ROOT_EXPORTS.filter((name) => typeof mod[name] !== 'function');
        if (missing.length > 0) throw new Error(`missing root exports: ${missing.join(', ')}`);
      }
      console.log(`ok   ${subpath} (${condition})`);
    } catch (error) {
      failures.push(`${subpath} (${condition}): ${error instanceof Error ? error.message : String(error)}`);
      console.log(`FAIL ${subpath} (${condition})`);
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} export(s) failed to load:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nall exports load under plain Node');
process.exit(0);
