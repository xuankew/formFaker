import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: watch,
  minify: !watch,
};

const entries = [
  { entry: resolve(root, '../src/content/index.ts'), outfile: resolve(root, '../dist/content.js') },
  { entry: resolve(root, '../src/background/index.ts'), outfile: resolve(root, '../dist/background.js') },
  { entry: resolve(root, '../src/dev/harness.ts'), outfile: resolve(root, '../dist/harness.js') },
];

for (const { entry, outfile } of entries) {
  if (watch) {
    const ctx = await build({ ...shared, entryPoints: [entry], outfile, watch: { onRebuild(err) {
      console.log(err ? `[workers] ${entry} rebuild failed` : `[workers] ${entry} rebuilt`);
    } } });
    void ctx;
  } else {
    await build({ ...shared, entryPoints: [entry], outfile });
  }
}
console.log('[workers] done');
