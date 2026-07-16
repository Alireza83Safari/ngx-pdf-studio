/**
 * Prepare `packages/pdf-studio/core/dist` as a publish-ready package (ADR-0005):
 * a rewritten package.json pointing at the compiled JS/d.ts, the bundled
 * Vazirmatn fonts (OFL) copied inside the package, and the license texts.
 * Publish with `npm publish packages/pdf-studio/core/dist`.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Downlevel TS 4.5+ inline `type` specifiers (`import { a, type B }`) into
 * separate `import type { B }` statements so the published d.ts parses under
 * TypeScript 4.3 (the Angular 12 toolchain, §2.1).
 */
function downlevelTypeSpecifiers(source) {
  return source.replace(
    /^(import|export)( \{[^}]*\btype [^}]*\})( from '[^']*')?;$/gm,
    (full, kind, braces, from) => {
      const entries = braces
        .slice(2, -1)
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
      const typeEntries = entries
        .filter((e) => e.startsWith('type '))
        .map((e) => e.slice(5).trim());
      const valueEntries = entries.filter((e) => !e.startsWith('type '));
      const suffix = from ?? '';
      const out = [];
      if (valueEntries.length) out.push(`${kind} { ${valueEntries.join(', ')} }${suffix};`);
      if (typeEntries.length) out.push(`${kind} type { ${typeEntries.join(', ')} }${suffix};`);
      return out.join('\n') || full;
    },
  );
}

function downlevelDtsTree(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += downlevelDtsTree(path);
    else if (entry.name.endsWith('.d.ts')) {
      const before = readFileSync(path, 'utf8');
      const after = downlevelTypeSpecifiers(before);
      if (after !== before) {
        writeFileSync(path, after);
        count += 1;
      }
    }
  }
  return count;
}

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

const downleveled = downlevelDtsTree(dist);

// Zod's own typings require TS 4.5+, which would break Angular 12 (TS 4.3)
// consumers just for *parsing* our d.ts chain. The schemas are runtime
// validators — publish them as opaque values so zod types never leak into the
// public surface (runtime behavior is untouched).
const OPAQUE_SCHEMAS = {
  'validation/template.schema.d.ts': ['templateSchema'],
  'validation/element.schema.d.ts': ['elementSchema'],
  'validation/primitives.schema.d.ts': null, // internal-only: no public exports
};
for (const [rel, names] of Object.entries(OPAQUE_SCHEMAS)) {
  const body = names
    ? names
        .map(
          (n) =>
            `/** Opaque runtime validator (zod under the hood); use \`validateTemplate\`/\`importTemplate\`. */\nexport declare const ${n}: unknown;\n`,
        )
        .join('')
    : 'export {};\n';
  writeFileSync(join(dist, rel), body);
}

console.log(`core dist prepared at ${dist} (${downleveled} d.ts downleveled for TS 4.3)`);
