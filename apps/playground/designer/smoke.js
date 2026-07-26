/* Smoke-test the designer in jsdom: load the real HTML + bundles, click the
   toolbox, and assert the WYSIWYG canvas + overlays + store behave. */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const dir = __dirname;
const html = readFileSync(join(dir, 'designer.html'), 'utf8');

const vm = require('node:vm');
const dom = new JSDOM(html.replace(/<script src="[^"]*"><\/script>/g, ''), {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'file://' + dir + '/',
});
const { window } = dom;

// jsdom lacks these occasionally-used APIs
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
// pdf-lib/fontkit reach for TextEncoder/TextDecoder, absent in jsdom's vm ctx
const { TextEncoder, TextDecoder } = require('node:util');
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
// jsdom's opaque-origin localStorage throws — give the app a real in-memory one
const mem = new Map();
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});

const ctx = dom.getInternalVMContext();
function run(file) {
  vm.runInContext(readFileSync(join(dir, file), 'utf8'), ctx, { filename: file });
}

try {
  run('engine.global.js');
  run('vazirmatn.js');
  run('templates.js');
  run('designer.js');

  const doc = window.document;
  const fail = (m) => {
    console.error('FAIL:', m);
    process.exit(1);
  };

  // WYSIWYG canvas painted?
  const svg = doc.querySelector('#pageSvg svg');
  if (!svg) fail('no WYSIWYG svg rendered');
  if (!svg.innerHTML.includes('فاکتور فروش')) fail('svg missing template text');

  // overlays for the 2 seed elements?
  let overlays = doc.querySelectorAll('.el');
  if (overlays.length !== 2) fail('expected 2 overlays, got ' + overlays.length);

  // add every toolbox type
  const types = [
    'staticText',
    'dataField',
    'rectangle',
    'line',
    'ellipse',
    'image',
    'barcode',
    'qrcode',
    'chart',
  ];
  for (const t of types) {
    doc
      .querySelector('[data-add="' + t + '"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  overlays = doc.querySelectorAll('.el');
  if (overlays.length !== 2 + types.length)
    fail('after adds expected ' + (2 + types.length) + ' overlays, got ' + overlays.length);

  // chart + barcode painted into the canvas svg?
  const svgHtml = doc.querySelector('#pageSvg').innerHTML;
  if (!svgHtml.includes('<rect')) fail('canvas svg has no rects (chart/barcode missing)');

  // inspector shows the last-added type
  if (!doc.getElementById('inspector').innerHTML.includes('chart'))
    fail('inspector not showing chart');

  // undo removes the chart again
  doc.getElementById('undo').dispatchEvent(new window.Event('click', { bubbles: true }));
  overlays = doc.querySelectorAll('.el');
  if (overlays.length !== 1 + types.length) fail('undo did not remove an element');

  // zoom label reacts
  doc.getElementById('zoomIn').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!/95%/.test(doc.getElementById('zoomLabel').textContent))
    fail('zoom label not updated: ' + doc.getElementById('zoomLabel').textContent);

  // field picker lists sample-data paths as draggable chips
  const chips = doc.querySelectorAll('#fieldPicker .fp-item');
  if (chips.length < 5) fail('field picker chips missing: ' + chips.length);
  const paths = Array.from(chips).map((c) => c.dataset.path);
  if (!paths.includes('customer.name')) fail('field picker missing customer.name');
  if (!paths.includes('items[0].name')) fail('field picker missing items[0].name');
  if (!paths.includes('len(items)')) fail('field picker missing len(items)');

  // select two overlays (shift-click) → z-order + align buttons appear
  const twoOverlays = doc.querySelectorAll('.el');
  const md = (el, shift) => {
    const ev = new window.MouseEvent('mousedown', {
      bubbles: true,
      shiftKey: shift,
      clientX: 0,
      clientY: 0,
    });
    el.dispatchEvent(ev);
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  };
  md(twoOverlays[0], false);
  // renderCanvas rebuilds overlay nodes on selection change — re-query
  md(doc.querySelectorAll('.el')[1], true);
  const insp = doc.getElementById('inspector');
  if (!insp.querySelector('[data-z="front"]')) fail('no z-order buttons');
  if (!insp.querySelector('[data-align="left"]')) fail('align buttons missing for multi-select');
  insp
    .querySelector('[data-align="left"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  // new-doc button exists; marquee/inline-edit hosts exist
  if (!doc.getElementById('newDoc')) fail('newDoc button missing');
  if (!doc.getElementById('marquee')) fail('marquee div missing');

  // --- template gallery (§8A-B) ---
  doc.getElementById('openGallery').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.getElementById('gallery').classList.contains('show')) fail('gallery did not open');
  const cards = doc.querySelectorAll('.tpl-card');
  if (cards.length < 13) fail('expected 13+ template cards, got ' + cards.length);
  const thumbs = doc.querySelectorAll('.tpl-thumb svg');
  if (thumbs.length < 13) fail('template thumbnails missing: ' + thumbs.length);
  // load the invoice template → canvas shows its title, sample data swapped
  const invoiceCard = doc.querySelector('.tpl-card[data-template="invoice"]');
  if (!invoiceCard) fail('invoice card missing');
  invoiceCard.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.getElementById('gallery').classList.contains('show'))
    fail('gallery did not close on load');
  const canvasSvg = doc.querySelector('#pageSvg').innerHTML;
  if (!canvasSvg.includes('فاکتور فروش')) fail('invoice template not on canvas');
  if (!doc.getElementById('sampleData').value.includes('لپ‌تاپ')) fail('sample data not swapped');
  const chips2 = Array.from(doc.querySelectorAll('#fieldPicker .fp-item')).map(
    (c) => c.dataset.path,
  );
  if (!chips2.includes('invoice.number')) fail('field picker not refreshed for template data');

  // --- Phase 4A ergonomics ---
  // professional dark chrome is the default; the toggle flips to light & back
  if (doc.body.dataset.theme !== 'dark') fail('default theme should be dark');
  doc.getElementById('toggleTheme').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.body.dataset.theme !== 'light') fail('theme toggle did not switch to light');
  doc.getElementById('toggleTheme').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.body.dataset.theme !== 'dark') fail('theme toggle did not switch back to dark');

  // preview-values toggle: canvas shows binding names instead of sample values
  doc.getElementById('toggleValues').dispatchEvent(new window.Event('click', { bubbles: true }));
  const namesSvg = doc.querySelector('#pageSvg').innerHTML;
  if (!namesSvg.includes('{customer.name}')) fail('values toggle did not show binding names');
  doc.getElementById('toggleValues').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.querySelector('#pageSvg').innerHTML.includes('{customer.name}'))
    fail('values toggle did not restore sample values');

  // command palette: Ctrl+K opens, lists commands, runs "افزودن متن"
  doc.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
  );
  if (!doc.getElementById('palette').classList.contains('show')) fail('palette did not open');
  const before = doc.querySelectorAll('.el').length;
  doc.getElementById('paletteInput').value = 'افزودن متن';
  doc.getElementById('paletteInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc
    .getElementById('paletteInput')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  if (doc.getElementById('palette').classList.contains('show')) fail('palette did not close');
  if (doc.querySelectorAll('.el').length !== before + 1) fail('palette command did not run');

  // --- professional-UX shell ---
  // editable doc name in the top bar
  if (!doc.getElementById('docName')) fail('docName input missing');
  if (!doc.getElementById('saveState')) fail('saveState indicator missing');
  // status bar: page info + selection info + fit zoom
  if (!/A4/.test(doc.getElementById('pageInfo').textContent)) fail('pageInfo missing A4');
  if (!doc.getElementById('zoomFit')) fail('zoomFit missing');
  // right-panel tabs switch panes
  const layersTab = doc.querySelector('.tab[data-tab="layers"]');
  if (!layersTab) fail('layers tab missing');
  layersTab.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.querySelector('.tabpane[data-pane="layers"]').classList.contains('active'))
    fail('layers pane did not activate');
  // layers list mirrors the elements on canvas
  const layerRows = doc.querySelectorAll('#layers .layer');
  const elCount = doc.querySelectorAll('.el').length;
  if (layerRows.length !== elCount)
    fail('layers rows ' + layerRows.length + ' != elements ' + elCount);
  // clicking a layer selects its element and the inspector opens (design tab via canvas)
  layerRows[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.querySelector('#layers .layer.selected')) fail('layer selection not reflected');
  // selection info in the status bar
  if (/چیزی انتخاب نشده/.test(doc.getElementById('selInfo').textContent))
    fail('selInfo did not update on selection');
  // quickbar appears above the selection
  if (!doc.getElementById('quickbar').classList.contains('show'))
    fail('quickbar not shown for selection');
  // quickbar duplicate works
  const beforeDup = doc.querySelectorAll('.el').length;
  doc
    .querySelector('#quickbar [data-q="dup"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.querySelectorAll('.el').length !== beforeDup + 1) fail('quickbar duplicate failed');
  // file menu opens and hosts the JSON actions
  doc.getElementById('fileMenuBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.getElementById('fileMenu').classList.contains('open')) fail('file menu did not open');
  if (!doc.getElementById('fileMenu').contains(doc.getElementById('exportJson')))
    fail('exportJson not in file menu');

  // --- universal tooltips ---
  if (!doc.getElementById('undo').dataset.tip) fail('undo missing data-tip');
  if (!doc.querySelector('#fieldPicker .fp-item').dataset.tip) fail('field chip missing data-tip');
  if (doc.querySelector('#fieldPicker .fp-item').getAttribute('title'))
    fail('chip title not upgraded to data-tip');
  if (!doc.querySelector('.tab[data-tab="layers"]').dataset.tip) fail('tab missing data-tip');
  if (!doc.getElementById('inspector').querySelector('[data-tip]'))
    fail('inspector controls missing tooltips');

  // --- blank template + page setup ---
  doc.getElementById('openGallery').dispatchEvent(new window.Event('click', { bubbles: true }));
  const blankCard = doc.querySelector('.tpl-card[data-template="blank"]');
  if (!blankCard) fail('blank template card missing');
  if (doc.querySelectorAll('.tpl-card')[0] !== blankCard) fail('blank template is not first');
  blankCard.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.querySelectorAll('.el').length !== 0) fail('blank template should have 0 elements');
  if (!doc.getElementById('canvasHint').classList.contains('show'))
    fail('canvas hint not shown on empty page');
  // page-size control switches the document size
  const sizeSel = doc.getElementById('pageSize');
  if (!sizeSel) fail('pageSize select missing');
  sizeSel.value = 'A5';
  sizeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (!/A5/.test(doc.getElementById('pageInfo').textContent))
    fail('pageInfo did not reflect A5: ' + doc.getElementById('pageInfo').textContent);
  const orientSel = doc.getElementById('pageOrient');
  orientSel.value = 'landscape';
  orientSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (!/افقی/.test(doc.getElementById('pageInfo').textContent))
    fail('pageInfo did not reflect landscape');
  // custom page size: picking 'سفارشی…' reveals the W×H inputs seeded with
  // the current dimensions; editing them resizes the document live
  sizeSel.value = '__custom__';
  sizeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const customRow = doc.getElementById('customSizeRow');
  if (customRow.style.display === 'none') fail('custom size row did not appear');
  if (!Number(doc.getElementById('pageW').value)) fail('custom width not seeded');
  doc.getElementById('pageW').value = '300';
  doc.getElementById('pageH').value = '200';
  doc.getElementById('pageH').dispatchEvent(new window.Event('change', { bubbles: true }));
  if (!/300\s*×\s*200|300×200/.test(doc.getElementById('pageInfo').textContent))
    fail('pageInfo did not reflect custom 300×200: ' + doc.getElementById('pageInfo').textContent);
  // switching back to a named size hides the row again
  sizeSel.value = 'A4';
  sizeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (customRow.style.display !== 'none') fail('custom row did not hide for named size');

  // adding an element hides the hint
  doc
    .querySelector('[data-add="staticText"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.getElementById('canvasHint').classList.contains('show'))
    fail('canvas hint still visible after adding an element');

  // money display format (ROADMAP 1.3): bind a numeric field, pick ریال
  doc
    .querySelector('[data-add="dataField"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  const srcInp = doc.querySelector('#inspector [data-prop="source"]');
  if (!srcInp) fail('binding input missing for dataField');
  srcInp.value = 'items[0].price';
  srcInp.dispatchEvent(new window.Event('change', { bubbles: true }));
  const fmtSel = doc.querySelector('#inspector [data-prop="fmt"]');
  if (!fmtSel) fail('display-format select missing');
  fmtSel.value = 'rial';
  fmtSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (!doc.querySelector('#pageSvg').innerHTML.includes('ریال'))
    fail('money format did not render ریال on canvas');

  // conditions UI (ROADMAP 2.3): visibleWhen 'false' hides the field from the canvas
  const visInp = doc.querySelector('#inspector [data-prop="viswhen"]');
  if (!visInp) fail('visibleWhen input missing');
  visInp.value = 'false';
  visInp.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (doc.querySelector('#pageSvg').innerHTML.includes('ریال'))
    fail('visibleWhen=false did not hide the element');
  const visInp2 = doc.querySelector('#inspector [data-prop="viswhen"]');
  visInp2.value = '';
  visInp2.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (!doc.querySelector('#pageSvg').innerHTML.includes('ریال'))
    fail('clearing visibleWhen did not restore the element');
  if (!doc.querySelector('#inspector [data-prop="condwhen"]'))
    fail('conditional-style inputs missing');

  // --- help center + interactive tour ---
  doc.getElementById('openHelp').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.getElementById('help').classList.contains('show')) fail('help did not open');
  const navBtns = doc.querySelectorAll('#helpNav button');
  if (navBtns.length < 10) fail('help sections missing: ' + navBtns.length);
  if (!doc.getElementById('helpContent').innerHTML.includes('چهار مفهوم'))
    fail('help start section not rendered');
  navBtns[3].dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.getElementById('helpContent').innerHTML.includes('زبان عبارت'))
    fail('help section switch failed');
  // tour: starts from help, highlights, advances, skip persists the flag
  doc.getElementById('startTour').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.getElementById('help').classList.contains('show')) fail('help should close for tour');
  if (!doc.getElementById('tour').classList.contains('show')) fail('tour did not start');
  if (
    !doc.getElementById('tourCard').innerHTML.includes('قدم 1 از 8') &&
    !doc.getElementById('tourCard').innerHTML.includes('قدم ۱')
  )
    fail('tour step 1 not shown: ' + doc.getElementById('tourCard').textContent.slice(0, 40));
  doc
    .querySelector('#tourCard [data-tour="next"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!doc.getElementById('tourCard').innerHTML.includes('بوم')) fail('tour did not advance');
  doc
    .querySelector('#tourCard [data-tour="skip"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.getElementById('tour').classList.contains('show')) fail('tour did not end on skip');
  try {
    if (window.localStorage.getItem('pdfstudio.toured') !== '1') fail('toured flag not persisted');
  } catch (e) {
    /* jsdom file:// has no localStorage — the designer guards this the same way */
  }

  // --- verifiable documents: stamp toggle + live code (F1.5) ---
  const vChk = doc.getElementById('verifyStamp');
  if (!vChk) fail('verify stamp checkbox missing');
  if (vChk.checked) fail('verify stamp should default off');
  if (doc.getElementById('verifyCodeRow').style.display !== 'none')
    fail('verify code row should be hidden when off');
  vChk.checked = true;
  vChk.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (doc.getElementById('verifyCodeRow').style.display === 'none')
    fail('verify code row should show when on');
  const vCode = doc.getElementById('verifyCode').textContent;
  if (!/^[0-9a-f]{10}$/.test(vCode)) fail('verify code not a 10-char hash prefix: ' + vCode);
  try {
    if (window.localStorage.getItem('pdfstudio.verify') !== '1')
      fail('verify toggle not persisted');
  } catch (e) {
    /* jsdom file:// has no localStorage — guarded the same way in the app */
  }
  // the live code is content-derived: editing the document changes it
  doc
    .querySelector('[data-add="staticText"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  const vCode2 = doc.getElementById('verifyCode').textContent;
  if (!/^[0-9a-f]{10}$/.test(vCode2)) fail('verify code invalid after edit: ' + vCode2);
  if (vCode2 === vCode) fail('verify code did not change after editing the document');

  (async () => {
    // --- share as link (ROADMAP 2.1) ---
    doc.getElementById('shareLink').dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!/^#t=/.test(window.location.hash)) fail('share did not set the #t= hash');
    // round-trip: craft a hash for the packing template and fire hashchange
    const tpl = ctx.window.PDFSTUDIO_TEMPLATES.find((t) => t.id === 'packing');
    const json = JSON.stringify(tpl.template);
    const b64 = window
      .btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    window.location.hash = 't=' + b64;
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    if (!doc.querySelector('#pageSvg').innerHTML.includes('لیست بسته‌بندی'))
      fail('template did not load from the share hash');

    // --- live data from URL (ROADMAP 2.2) ---
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ live: { greeting: 'سلام زنده' }, items: [{ name: 'x', qty: 1 }] }),
    });
    doc.getElementById('liveUrl').value = 'https://api.example.com/data';
    doc.getElementById('liveFetch').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    if (!doc.getElementById('sampleData').value.includes('سلام زنده'))
      fail('live fetch did not replace sample data');
    const liveChips = Array.from(doc.querySelectorAll('#fieldPicker .fp-item')).map(
      (c) => c.dataset.path,
    );
    if (!liveChips.includes('live.greeting')) fail('field picker not refreshed from live data');

    // --- version history (ROADMAP 2.4) ---
    await new Promise((r) => setTimeout(r, 500)); // let the autosave debounce flush
    doc.getElementById('openHistory').dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!doc.getElementById('history').classList.contains('show')) fail('history did not open');
    const histRows = doc.querySelectorAll('#historyList .hist-row');
    if (histRows.length < 1) fail('no history snapshots recorded');
    doc
      .querySelector('#historyList [data-hist="0"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    if (doc.getElementById('history').classList.contains('show'))
      fail('history did not close after restore');

    // --- AI copilot (ROADMAP 3.2) ---
    // scripted provider: first a broken template, then a valid one (repair loop).
    // Use `invoice` (a clean, fully on-page template) so the bounds guardrail
    // doesn't add an extra repair round — `card` bleeds off-page by design.
    const cpValid = JSON.stringify({
      ...ctx.window.PDFSTUDIO_TEMPLATES.find((t) => t.id === 'invoice').template,
      metadata: { name: 'ساختهٔ کوپایلوت' },
    });
    const cpBroken = cpValid.replace(/"bounds":\s*\{[^}]*\},/, '');
    let cpCall = 0;
    ctx.window.PDFSTUDIO_COPILOT_PROVIDER = {
      complete: async () => (cpCall++ === 0 ? cpBroken : cpValid),
    };
    doc.getElementById('openCopilot').dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!doc.getElementById('copilot').classList.contains('show')) fail('copilot did not open');
    // provider presets: default is the free-tier groq, claude hides url/model, ollama needs no key
    if (doc.getElementById('cpProvider').value !== 'groq') fail('default provider is not groq');
    if (doc.getElementById('cpBaseUrlRow').style.display === 'none')
      fail('groq preset should show the baseUrl row');
    if (!/groq/.test(doc.getElementById('cpBaseUrl').value)) fail('groq baseUrl not prefilled');
    doc.getElementById('cpProvider').value = 'claude';
    doc.getElementById('cpProvider').dispatchEvent(new window.Event('change', { bubbles: true }));
    if (doc.getElementById('cpBaseUrlRow').style.display !== 'none')
      fail('claude should hide the baseUrl row');
    doc.getElementById('cpProvider').value = 'ollama';
    doc.getElementById('cpProvider').dispatchEvent(new window.Event('change', { bubbles: true }));
    if (doc.getElementById('cpKeyRow').style.display !== 'none')
      fail('ollama should hide the key row');
    if (!/11434/.test(doc.getElementById('cpBaseUrl').value)) fail('ollama baseUrl not prefilled');
    doc.getElementById('cpPrompt').value = 'یک کارت ویزیت بساز';
    doc.getElementById('cpRun').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    if (cpCall !== 2) fail('repair loop did not run (calls=' + cpCall + ')');
    if (doc.getElementById('copilot').classList.contains('show'))
      fail('copilot did not close after success');
    if (doc.getElementById('docName').value !== 'ساختهٔ کوپایلوت')
      fail('copilot template not applied: ' + doc.getElementById('docName').value);
    // one undo returns the previous document
    doc.getElementById('undo').dispatchEvent(new window.Event('click', { bubbles: true }));
    if (doc.getElementById('docName').value === 'ساختهٔ کوپایلوت')
      fail('copilot apply was not a single undoable command');

    // free-provider presets: picking Groq fills the OpenAI-compatible fields
    doc.getElementById('openCopilot').dispatchEvent(new window.Event('click', { bubbles: true }));
    const provSel = doc.getElementById('cpProvider');
    if (!provSel) fail('provider select missing');
    provSel.value = 'groq';
    provSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (!doc.getElementById('cpBaseUrl').value.includes('groq'))
      fail('groq preset did not fill baseUrl: ' + doc.getElementById('cpBaseUrl').value);
    if (doc.getElementById('cpBaseUrlRow').style.display === 'none')
      fail('baseUrl row hidden for OpenAI-compatible provider');
    provSel.value = 'ollama';
    provSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (doc.getElementById('cpKeyRow').style.display !== 'none')
      fail('key row should hide for keyless Ollama');
    doc.getElementById('closeCopilot').dispatchEvent(new window.Event('click', { bubbles: true }));

    // --- Format Cloner (F2.5) ---
    // jsdom has no real pdfjs; inject a structural fake that yields an invoice
    // (header field + a 3-column table) so the clone → bind → review flow runs.
    const item = (str, x, y) => ({
      str,
      dir: 'ltr',
      transform: [10, 0, 0, 10, x, y],
      width: str.length * 5,
    });
    const fakeItems = [
      item('Invoice No:', 40, 800),
      item('INV-1024', 140, 800),
      item('Item', 40, 700),
      item('Qty', 300, 700),
      item('Price', 420, 700),
      item('widget', 40, 680),
      item('2', 300, 680),
      item('1,000', 420, 680),
      item('gadget', 40, 660),
      item('5', 300, 660),
      item('2,000', 420, 660),
    ];
    const fakePage = {
      getViewport: () => ({ width: 595, height: 842 }),
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({ items: fakeItems }),
    };
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => fakePage }),
      }),
    };
    const pdfInput = doc.getElementById('pdfInput');
    Object.defineProperty(pdfInput, 'files', {
      configurable: true,
      value: [{ name: 'invoice.pdf', arrayBuffer: async () => new ArrayBuffer(0) }],
    });
    pdfInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    // wait for the async clone pipeline to finish
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (doc.getElementById('cloneReview').classList.contains('show')) break;
    }
    if (!doc.getElementById('cloneReview').classList.contains('show'))
      fail('clone review modal did not open');
    const reviewHtml = doc.getElementById('cloneReviewBody').innerHTML;
    if (!reviewHtml.includes('invoice_no')) fail('clone review missing the invoice_no field chip');
    if (!reviewHtml.includes('items')) fail('clone review missing the items table chip');
    if (doc.getElementById('docName').value !== 'invoice')
      fail('cloned template name not applied: ' + doc.getElementById('docName').value);
    if (!doc.getElementById('sampleData').value.includes('INV-1024'))
      fail('inferred sample data not loaded into the data tab');
    const clonedSvg = doc.querySelector('#pageSvg').innerHTML;
    if (!clonedSvg.includes('INV-1024')) fail('cloned bound field did not render its sample value');
    if (!clonedSvg.includes('widget')) fail('cloned table did not render its rows');
    doc
      .getElementById('closeCloneReview')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    if (doc.getElementById('cloneReview').classList.contains('show'))
      fail('clone review did not close');

    // --- verified PDF download (F1.5) ---
    // verify is still ON from the sync block; the download must stamp the mark
    // and surface the same short code shown live in the panel (same input path).
    const panelCode = doc.getElementById('verifyCode').textContent;
    if (!/^[0-9a-f]{10}$/.test(panelCode)) fail('panel verify code missing before download');
    doc.getElementById('downloadPdf').dispatchEvent(new window.Event('click', { bubbles: true }));
    let tmsg = '';
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const m = doc.querySelector('#toast .t-msg');
      tmsg = m ? m.textContent : '';
      if (/کدِ تأیید/.test(tmsg)) break;
    }
    if (!/کدِ تأیید/.test(tmsg)) fail('verified download toast missing the code: ' + tmsg);
    if (!tmsg.includes(panelCode))
      fail('printed code != panel code: "' + tmsg + '" vs ' + panelCode);

    // --- migrated command vocabulary (core/src/document) ---
    // Every editing command now comes from the engine instead of being redefined
    // here; drive the real UI for each migrated path and check undo restores.
    const P = window.PdfStudio;
    const store = window.__designerStore;
    if (!store) fail('designer did not expose its store for testing');
    const nameOf = () => store.getState().metadata.name;
    const bandIds = () => store.getState().bands.map((b) => b.id);

    // rename (P.renameTemplate)
    const docName = doc.getElementById('docName');
    const beforeName = nameOf();
    docName.value = 'نامِ تازه';
    docName.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (nameOf() !== 'نامِ تازه') fail('rename did not apply: ' + nameOf());
    store.undo();
    if (nameOf() !== beforeName) fail('rename undo failed: ' + nameOf());

    // band add / patch / reorder / remove (P.addBand, patchBand, moveBand, removeBandById)
    const bandsBefore = bandIds();
    doc
      .querySelector('[data-band-add]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    if (bandIds().length !== bandsBefore.length + 1)
      fail('addBand did not add a band: ' + bandIds().join(','));
    const addedBand = bandIds()[bandIds().length - 1];
    const hInp = doc.querySelector('[data-band-height]');
    hInp.value = '77';
    hInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    const heightOf = (id) => {
      const b = store.getState().bands.find((x) => x.id === id);
      return b && b.height.value;
    };
    if (heightOf(addedBand) !== 77) fail('patchBand height failed: ' + heightOf(addedBand));
    store.undo();
    if (heightOf(addedBand) === 77) fail('patchBand undo failed');
    const up = doc.querySelector('[data-band-up]');
    if (up) {
      up.dispatchEvent(new window.Event('click', { bubbles: true }));
      if (bandIds()[bandIds().length - 1] === addedBand)
        fail('moveBand did not reorder the band stack');
      store.undo();
      if (bandIds()[bandIds().length - 1] !== addedBand) fail('moveBand undo failed');
    }
    // the reorder moved the active band along with it, and undo restores the
    // stack but not the selection — re-activate the added band before deleting
    doc
      .querySelector('[data-band="' + bandIds().indexOf(addedBand) + '"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    doc
      .querySelector('[data-band-del]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    if (bandIds().join(',') !== bandsBefore.join(','))
      fail('removeBandById did not restore the original stack: ' + bandIds().join(','));

    // align + z-order over a real multi-selection (P.setElementsBounds, setElementZIndex)
    const bandId = store.getState().bands[0].id;
    const mk = (id, x, y) => ({
      id,
      type: 'staticText',
      bounds: { x, y, width: 40, height: 16 },
      zIndex: 1,
      text: id,
    });
    store.dispatch(
      P.composite([
        P.addElement(bandId, mk('sm-1', 10, 10)),
        P.addElement(bandId, mk('sm-2', 90, 60)),
      ]),
    );
    const xOf = (id) => P.findElement(store.getState(), id).element.bounds.x;
    const zOf = (id) => P.findElement(store.getState(), id).element.zIndex;
    store.dispatch(
      P.setElementsBounds({
        'sm-1': { x: 10, y: 10, width: 40, height: 16 },
        'sm-2': { x: 10, y: 60, width: 40, height: 16 },
      }),
    );
    if (xOf('sm-2') !== 10) fail('setElementsBounds align failed: ' + xOf('sm-2'));
    store.undo();
    if (xOf('sm-2') !== 90) fail('setElementsBounds undo failed: ' + xOf('sm-2'));
    store.dispatch(P.composite([P.setElementZIndex('sm-1', 9), P.setElementZIndex('sm-2', 9)]));
    if (zOf('sm-1') !== 9 || zOf('sm-2') !== 9) fail('setElementZIndex failed');
    store.undo();
    if (zOf('sm-1') !== 1) fail('setElementZIndex undo failed');

    // nudge (P.moveElementsBy) — its own exact inverse
    store.dispatch(P.moveElementsBy(['sm-1', 'sm-2'], 5, 0));
    if (xOf('sm-1') !== 15) fail('moveElementsBy failed: ' + xOf('sm-1'));
    store.undo();
    if (xOf('sm-1') !== 10) fail('moveElementsBy undo failed: ' + xOf('sm-1'));

    // --- lock + rename + relative z-order (§8A) ---
    const clickEv = () => new window.MouseEvent('click', { bubbles: true });
    const layerFor = (id) => doc.querySelector('#layers [data-id="' + id + '"]');
    if (!layerFor('sm-1')) fail('layers panel missing the test elements');
    layerFor('sm-1').dispatchEvent(clickEv());

    // the shortcut handler ignores keys while a text field is focused, and
    // earlier steps leave one focused — blur first or these checks are vacuous
    const key = (k) => {
      if (doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    };
    const el1 = () => P.findElement(store.getState(), 'sm-1').element;

    // baseline: while unlocked, the arrow key really does nudge (proves wiring)
    const yStart = el1().bounds.y;
    key('ArrowDown');
    if (el1().bounds.y !== yStart + 1) fail('arrow nudge is not wired: ' + el1().bounds.y);
    store.undo();

    // lock from the layers panel: the row's toggle must not also re-select
    const lockBtn = doc.querySelector('#layers [data-lock="sm-1"]');
    if (!lockBtn) fail('layer lock button missing');
    lockBtn.dispatchEvent(clickEv());
    if (el1().locked !== true) fail('lock toggle did not lock the element');
    if (doc.querySelector('#layers [data-lock="sm-1"]').getAttribute('aria-pressed') !== 'true')
      fail('lock button aria-pressed not updated');
    // a locked element offers no resize handle, and refuses arrows and Delete
    if (doc.querySelector('.el.selected .handle'))
      fail('locked element still shows a resize handle');
    key('ArrowDown');
    if (el1().bounds.y !== yStart) fail('arrow key moved a locked element');
    key('Delete');
    if (!P.findElement(store.getState(), 'sm-1')) fail('Delete removed a locked element');

    // unlock → the nudge works again
    doc.querySelector('#layers [data-lock="sm-1"]').dispatchEvent(clickEv());
    if (el1().locked !== false) fail('lock toggle did not unlock');
    layerFor('sm-1').dispatchEvent(clickEv());
    key('ArrowDown');
    if (el1().bounds.y !== yStart + 1) fail('unlocked element still refuses to move');
    store.undo();

    // rename from the inspector; the layers row picks the name up
    const nameInp = doc.querySelector('#inspector [data-prop="name"]');
    if (!nameInp) fail('inspector name field missing');
    nameInp.value = 'لوگوی شرکت';
    nameInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (el1().name !== 'لوگوی شرکت') fail('rename did not apply: ' + el1().name);
    if (!/لوگوی شرکت/.test(layerFor('sm-1').textContent))
      fail('layers row did not pick up the element name');
    store.undo();
    if (el1().name) fail('rename undo failed');

    // relative z-order: one step up swaps with the neighbour above. Park both
    // test elements above every template element so they neighbour each other.
    store.dispatch(P.setElementZIndex('sm-1', 900));
    store.dispatch(P.setElementZIndex('sm-2', 901));
    layerFor('sm-1').dispatchEvent(clickEv());
    const zStep = doc.querySelector('#inspector [data-zstep="forward"]');
    if (!zStep) fail('relative z-order buttons missing');
    zStep.dispatchEvent(clickEv());
    const zOf2 = (id) => P.findElement(store.getState(), id).element.zIndex;
    if (zOf2('sm-1') !== 901 || zOf2('sm-2') !== 900)
      fail('forward did not swap z with the neighbour: ' + zOf2('sm-1') + '/' + zOf2('sm-2'));
    store.undo();
    if (zOf2('sm-1') !== 900 || zOf2('sm-2') !== 901) fail('z-order swap undo failed');

    // --- group / ungroup (§8A) ---
    // select both via the layers panel, then group through the inspector button
    const layerRow = (id) => doc.querySelector('#layers [data-id="' + id + '"]');
    if (!layerRow('sm-1')) fail('layers panel missing the test elements');
    layerRow('sm-1').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    layerRow('sm-2').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    const groupBtn = doc.querySelector('[data-group]');
    if (!groupBtn) fail('group button missing for a multi-selection');
    groupBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    const grp = store.getState().bands[0].elements.filter((e) => e.type === 'container')[0];
    if (!grp) fail('grouping did not create a container');
    if (grp.children.length !== 2) fail('group has ' + grp.children.length + ' children, want 2');
    // the bounding box of (10,10,40,16) and (10,60,40,16)
    if (grp.bounds.x !== 10 || grp.bounds.height !== 66)
      fail('group bounds wrong: ' + JSON.stringify(grp.bounds));
    // children are container-local now
    if (P.findElement(store.getState(), 'sm-1').element.bounds.y !== 0)
      fail('group child was not rebased into container-local coordinates');
    // the group shows as ONE row in the layers panel, labelled with its size
    if (!layerRow(grp.id) || !/گروه · 2/.test(layerRow(grp.id).textContent))
      fail('layers panel does not show the group row');
    // dragging the group carries the children: nudge it and check the painted svg
    const paintedBefore = doc.querySelector('#pageSvg').innerHTML;
    store.dispatch(P.moveElementsBy([grp.id], 20, 0));
    if (doc.querySelector('#pageSvg').innerHTML === paintedBefore)
      fail('moving the group did not repaint its children');
    store.undo();

    // ungroup restores absolute bounds and the original layer rows
    doc
      .querySelector('#layers [data-id="' + grp.id + '"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const ungroupBtn = doc.querySelector('[data-ungroup]');
    if (!ungroupBtn) fail('ungroup button missing for a selected group');
    ungroupBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    if (P.findElement(store.getState(), grp.id)) fail('ungroup left the container behind');
    if (P.findElement(store.getState(), 'sm-1').element.bounds.y !== 10)
      fail('ungroup did not fold the container offset back into the child');

    // one undo per gesture: undo re-groups, undo again restores the flat band
    store.undo();
    if (!P.findElement(store.getState(), grp.id)) fail('undo did not restore the group');
    store.undo();
    if (P.findElement(store.getState(), grp.id)) fail('second undo did not ungroup again');
    if (P.findElement(store.getState(), 'sm-1').element.bounds.y !== 10)
      fail('undo left the child in container-local coordinates');

    // --- style library + saved components (§8A-B) ---
    // The cloned document carries no named styles, so make some the way a user
    // would: adding a table atomically declares its cell/header styles.
    const styleRows = () => Array.from(doc.querySelectorAll('#styleList .st-row'));
    if (styleRows().length) fail('expected no named styles before adding a table');
    doc.querySelector('[data-add="table"]').dispatchEvent(clickEv());
    if (styleRows().length < 2)
      fail('adding a table did not surface its styles: ' + styleRows().length);
    const firstStyleId = styleRows()[0].dataset.style;
    const styleById = (id) => (store.getState().styles || []).filter((s) => s.id === id)[0];

    // apply a style to the selection
    layerFor('sm-1').dispatchEvent(clickEv());
    doc.querySelector('[data-style-apply="' + firstStyleId + '"]').dispatchEvent(clickEv());
    if (P.findElement(store.getState(), 'sm-1').element.styleId !== firstStyleId)
      fail('apply-style did not set styleId');

    // rename a style inline; the row and the model both follow
    const nameSpan = doc.querySelector('[data-style-rename="' + firstStyleId + '"]');
    nameSpan.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    const styleInput = doc.querySelector('#styleList .l-rename');
    if (!styleInput) fail('style rename input did not appear');
    styleInput.value = 'سبکِ تازه';
    styleInput.dispatchEvent(new window.Event('blur', { bubbles: true }));
    if (styleById(firstStyleId).name !== 'سبکِ تازه')
      fail('style rename did not apply: ' + styleById(firstStyleId).name);

    // duplicate → one more style, same typography
    const beforeDup = (store.getState().styles || []).length;
    doc.querySelector('[data-style-dup="' + firstStyleId + '"]').dispatchEvent(clickEv());
    if ((store.getState().styles || []).length !== beforeDup + 1)
      fail('duplicate-style did not add a style');
    store.undo();

    // delete → the style goes and the reference we just applied is cleared
    doc.querySelector('[data-style-del="' + firstStyleId + '"]').dispatchEvent(clickEv());
    if (styleById(firstStyleId)) fail('delete-style left the style behind');
    if (P.findElement(store.getState(), 'sm-1').element.styleId)
      fail('delete-style left a dangling styleId reference');
    store.undo();
    if (!styleById(firstStyleId)) fail('undo did not restore the deleted style');
    if (P.findElement(store.getState(), 'sm-1').element.styleId !== firstStyleId)
      fail('undo did not restore the cleared style reference');

    // save the selection as a component, then insert it back
    layerFor('sm-1').dispatchEvent(clickEv());
    layerFor('sm-2').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    window.prompt = () => 'سربرگِ من';
    doc.getElementById('saveSnippet').dispatchEvent(clickEv());
    const snipRows = () => Array.from(doc.querySelectorAll('#snippetList .st-row'));
    if (snipRows().length !== 1) fail('saved component was not listed: ' + snipRows().length);
    if (!/سربرگِ من/.test(snipRows()[0].textContent)) fail('component row missing its name');

    const countBefore = store.getState().bands[0].elements.length;
    doc.querySelector('[data-snip-insert]').dispatchEvent(clickEv());
    if (store.getState().bands[0].elements.length !== countBefore + 2)
      fail('inserting the component did not add its 2 elements');
    // inserting twice must not collide on ids
    doc.querySelector('[data-snip-insert]').dispatchEvent(clickEv());
    const allIds = store.getState().bands[0].elements.map((e) => e.id);
    if (new Set(allIds).size !== allIds.length) fail('component insert produced duplicate ids');
    store.undo();
    store.undo();
    if (store.getState().bands[0].elements.length !== countBefore)
      fail('component insert is not one undo step each');

    // --- visible undo history (§8A) ---
    doc.getElementById('openHistory').dispatchEvent(clickEv());
    const stepRows = () => Array.from(doc.querySelectorAll('#stepList .st-row'));
    if (stepRows().length !== store.getHistory().length)
      fail('step list does not match the store history: ' + stepRows().length);
    // the type is mapped to Persian wording in the designer, not in core
    if (/^[a-z]/i.test(stepRows()[0].querySelector('.st-name').textContent.trim()))
      fail('step label was not translated: ' + stepRows()[0].textContent);
    // newest first: the top row is labelled "الان"
    if (!/الان/.test(stepRows()[0].textContent)) fail('newest step is not marked as current');

    // jumping back to a step rewinds the document and shortens the list
    const stepsBefore = store.getHistory().length;
    const targetBtn = doc.querySelector('#stepList [data-step="' + (stepsBefore - 3) + '"]');
    if (!targetBtn) fail('no step button to jump to');
    targetBtn.dispatchEvent(clickEv());
    if (store.getHistory().length !== stepsBefore - 2)
      fail('undoTo did not rewind to the chosen step: ' + store.getHistory().length);
    if (!store.canRedo()) fail('jumping back should leave the steps redoable');
    doc.getElementById('closeHistory').dispatchEvent(clickEv());

    console.log(
      'designer smoke OK — overlays:',
      overlays.length,
      '| chips:',
      chips.length,
      '| svg bytes:',
      svgHtml.length,
    );
    process.exit(0);
  })().catch((e) => {
    console.error('ASYNC CRASH:', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
    process.exit(1);
  });
} catch (e) {
  console.error('CRASH:', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
  process.exit(1);
}
