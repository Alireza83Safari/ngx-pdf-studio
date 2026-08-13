/**
 * Documentation page smoke: load `docs/index.html` in jsdom, run its real
 * script, and assert the things that rot silently — a string that never got
 * translated, a highlighter that eats code, a direction that stops flipping,
 * a contents link pointing at a section someone renamed.
 *
 * jsdom arrives transitively via jest-environment-jsdom, the same way
 * `apps/playground/designer/smoke.js` gets it.
 *
 * Run: npm run smoke:docs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'docs/index.html');

const dom = new JSDOM(readFileSync(page, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { document } = dom.window;
const fail = [];

const click = (selector) =>
  document
    .querySelector(selector)
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

// --- the page's own script ran ------------------------------------------
const nodes = [...document.querySelectorAll('[data-i18n]')];
if (nodes.length === 0) fail.push('no [data-i18n] nodes found — did the markup change?');

// --- code samples survived highlighting ----------------------------------
const codes = [...document.querySelectorAll('.code pre code')];
if (codes.length === 0) fail.push('no code blocks found');
for (const block of codes) {
  if (!block.querySelector('span')) {
    fail.push(`code block never highlighted: ${block.textContent.slice(0, 40)}`);
  }
  if (block.innerHTML.includes('\0')) fail.push('NUL byte inside a code block');
}
const allCode = codes.map((c) => c.textContent).join('\n');
for (const symbol of [
  'renderToFile',
  'PdfStudioRenderer',
  'DocumentStore',
  'loadBundledVazirmatn',
]) {
  if (!allCode.includes(symbol)) fail.push(`highlighting lost a code sample: ${symbol}`);
}

// --- every authored string has an English counterpart ---------------------
// jsdom reports navigator.language as en-US, so the page boots in English.
// Force Persian first so the baseline is what the markup actually authored.
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ON_PURPOSE = new Set(['expr.fnWords']); // the toWords example

click('[data-lang="fa"]');
const authored = new Map(nodes.map((n) => [n.getAttribute('data-i18n'), n.innerHTML]));
if (![...authored.values()].some((v) => PERSIAN.test(v))) {
  fail.push('baseline is not Persian — switching to fa did nothing');
}

click('[data-lang="en"]');
const untranslated = [];
for (const node of nodes) {
  const key = node.getAttribute('data-i18n');
  if (PERSIAN_ON_PURPOSE.has(key)) continue;
  if (PERSIAN.test(node.innerHTML)) untranslated.push(key);
}
if (untranslated.length) fail.push(`untranslated in English: ${untranslated.join(', ')}`);

// --- direction flips, and Persian round-trips intact ----------------------
const root_ = document.documentElement;
if (root_.getAttribute('dir') !== 'ltr') fail.push(`dir stuck at ${root_.getAttribute('dir')}`);
if (root_.getAttribute('lang') !== 'en') fail.push(`lang stuck at ${root_.getAttribute('lang')}`);

click('[data-lang="fa"]');
if (root_.getAttribute('dir') !== 'rtl') fail.push('dir did not flip back to rtl');
for (const node of nodes) {
  const key = node.getAttribute('data-i18n');
  if (node.innerHTML !== authored.get(key)) {
    fail.push(`round trip lost the Persian for ${key}`);
    break;
  }
}

// --- the contents list still points at real sections ----------------------
const links = [...document.querySelectorAll('.toc a')];
if (links.length === 0) fail.push('contents list is empty — did .toc get renamed?');
for (const link of links) {
  if (!document.querySelector(link.getAttribute('href'))) {
    fail.push(`contents link points nowhere: ${link.getAttribute('href')}`);
  }
}

// --- nothing is fetched over the network ----------------------------------
for (const el of document.querySelectorAll('[src], link[href]')) {
  const url = el.getAttribute('src') || el.getAttribute('href');
  if (url && /^(https?:)?\/\//.test(url)) fail.push(`external resource: ${url}`);
}

// --- the README's coverage claim is the gate that is actually enforced -----
//
// The README used to open with "716 tests green ... at 93% statement coverage".
// Both had drifted — 912 and 94.09% by the time anyone checked — because a
// count of tests changes on almost every commit and nothing compared it to
// anything. An exact tally is a vanity number with no reader; the *threshold*
// is the claim that means something, and it is a number that exists in the jest
// configs, so it can be checked rather than trusted.
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const claimed = /≥(\d+)% statement coverage/.exec(readme);
if (!claimed) {
  fail.push('README no longer states a statement-coverage gate');
} else {
  const configs = [
    'packages/pdf-studio/core/jest.config.ts',
    'packages/pdf-studio/angular/jest.config.ts',
  ];
  for (const config of configs) {
    const source = readFileSync(join(root, config), 'utf8');
    const enforced = /statements:\s*(\d+)/.exec(source);
    if (!enforced) {
      fail.push(`${config} has no statement threshold, but the README claims one`);
    } else if (enforced[1] !== claimed[1]) {
      fail.push(`README claims ≥${claimed[1]}% statements, ${config} enforces ${enforced[1]}%`);
    }
  }
}

if (fail.length) {
  console.error('docs smoke FAILED:');
  for (const problem of fail) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `docs smoke passed — ${nodes.length} translated strings, ${codes.length} code blocks, ` +
    `${links.length} contents links`,
);
