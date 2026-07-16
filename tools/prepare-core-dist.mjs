/**
 * Prepare `packages/pdf-studio/core/dist` as a publish-ready package (ADR-0005):
 * a rewritten package.json pointing at the compiled JS/d.ts, the bundled
 * Vazirmatn fonts (OFL) copied inside the package, and the license texts.
 * Publish with `npm publish packages/pdf-studio/core/dist`.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages/pdf-studio/core');
const dist = join(pkgDir, 'dist');

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const published = {
  ...pkg,
  main: './index.js',
  types: './index.d.ts',
  exports: {
    '.': { types: './index.d.ts', default: './index.js' },
    './node': { types: './node/index.d.ts', node: './node/index.js', default: './node/index.js' },
  },
  files: undefined,
  scripts: undefined,
  devDependencies: undefined,
};
writeFileSync(join(dist, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);

const fontsSrc = join(root, 'packages/pdf-studio/pdf/fonts/vazirmatn');
const fontsDest = join(dist, 'fonts/vazirmatn');
mkdirSync(fontsDest, { recursive: true });
for (const file of ['Vazirmatn-Regular.ttf', 'Vazirmatn-Bold.ttf', 'OFL.txt']) {
  copyFileSync(join(fontsSrc, file), join(fontsDest, file));
}

copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'));
copyFileSync(join(root, 'README.md'), join(dist, 'README.md'));

console.log('core dist prepared at', dist);
