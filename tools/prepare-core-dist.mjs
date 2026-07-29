/**
 * Prepare `packages/pdf-studio/core/dist` as a publish-ready package (ADR-0005):
 * a rewritten package.json pointing at the compiled JS/d.ts, the bundled
 * Vazirmatn fonts (OFL) copied inside the package, and the license texts.
 * Publish with `npm publish packages/pdf-studio/core/dist`.
 *
 * The package is **dual-format**: `dist/` is CommonJS and `dist/esm/` is the
 * same sources emitted as real ES modules, selected by the `import` condition.
 * A bundler cannot statically analyse a CommonJS entry, so without the ESM half
 * an Angular application gets optimization-bailout warnings and ships code it
 * could have tree-shaken away.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/**
 * Relative specifier in an `import`/`export ... from` or a dynamic `import()`.
 * Anchored on the keyword rather than on quotes alone so ordinary strings in
 * the code are never touched.
 */
const RELATIVE_SPECIFIER = /(from\s*|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;

/**
 * TypeScript emits ES modules with the same extensionless specifiers it read
 * (`from './model'`), but Node's ESM resolver does no extension or directory
 * guessing — it would throw ERR_MODULE_NOT_FOUND on the first import. Rewrite
 * each specifier against what was actually emitted next to it: `./command`
 * becomes `./command.js`, and `./model` becomes `./model/index.js`.
 *
 * Declarations get the same treatment: a consumer on `node16` resolution reads
 * `./x.js` in a `.d.ts` and looks for `./x.d.ts`, so the `.js` suffix is what
 * both file kinds need.
 */
function addEsmExtensions(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += addEsmExtensions(path);
      continue;
    }
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue;

    const here = dirname(path);
    const before = readFileSync(path, 'utf8');
    const after = before.replace(RELATIVE_SPECIFIER, (full, keyword, quote, spec) => {
      if (/\.[cm]?js$/.test(spec)) return full;
      const target = resolve(here, spec);
      let fixed;
      if (existsSync(`${target}.js`)) fixed = `${spec}.js`;
      else if (existsSync(join(target, 'index.js'))) fixed = `${spec}/index.js`;
      else return full;
      return `${keyword}${quote}${fixed}${quote}`;
    });
    if (after !== before) {
      writeFileSync(path, after);
      count += 1;
    }
  }
  return count;
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
  // Legacy bundler field (webpack 4, older Angular toolchains) for resolvers
  // that predate `exports`; modern ones take the `import` condition below.
  module: './esm/index.js',
  types: './index.d.ts',
  exports: {
    // Types are declared per condition: the ESM half lives under a nested
    // `{"type":"module"}` package.json, so a `node16`-resolution consumer must
    // be handed declarations it will read as ESM, not the CommonJS ones.
    '.': {
      import: { types: './esm/index.d.ts', default: './esm/index.js' },
      require: { types: './index.d.ts', default: './index.js' },
      default: './index.js',
    },
    // CommonJS only, on purpose: this entry locates the bundled fonts with
    // `__dirname`. It is the server-side path, so there is no bundle to
    // optimize, and Node reads its named exports from CommonJS fine.
    './node': { types: './node/index.d.ts', default: './node/index.js' },
    './package.json': './package.json',
  },
  files: undefined,
  scripts: undefined,
  devDependencies: undefined,
};
writeFileSync(join(dist, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);

// Marks `dist/esm/**` as ES modules while the package as a whole stays
// CommonJS, so both halves keep plain `.js` extensions.
const esm = join(dist, 'esm');
if (!existsSync(join(esm, 'index.js'))) {
  console.error('esm build missing — run `tsc -p packages/pdf-studio/core/tsconfig.lib.esm.json`');
  process.exit(1);
}
writeFileSync(join(esm, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
const extended = addEsmExtensions(esm);

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
  // Both halves of the dual package, or zod's types leak back in through the
  // `import` condition — the one a modern consumer actually resolves.
  writeFileSync(join(dist, rel), body);
  writeFileSync(join(esm, rel), body);
}

console.log(
  `core dist prepared at ${dist} ` +
    `(${downleveled} d.ts downleveled for TS 4.3, ${extended} esm files given extensions)`,
);
