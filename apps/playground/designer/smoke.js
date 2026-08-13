/* Smoke-test the designer in jsdom: load the real HTML + bundles, click the
   toolbox, and assert the WYSIWYG canvas + overlays + store behave. */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const dir = __dirname;
const html = readFileSync(join(dir, 'designer.html'), 'utf8');

/**
 * jsdom implements no navigation, so every "download" the designer performs —
 * an `<a download href="blob:">` that gets clicked — reports a `jsdomError` with
 * a stack, in the middle of a passing run. It read like a failure and hid the
 * line that said whether anything actually broke.
 *
 * Filtered by message, not silenced: any other `jsdomError` is a real problem
 * (a script that threw, a resource that failed) and still gets printed. A
 * virtual console that swallows everything is worse than the noise it removes.
 */
const virtualConsole = new VirtualConsole();
virtualConsole.sendTo(console, { omitJSDOMErrors: true });
virtualConsole.on('jsdomError', (err) => {
  if (/Not implemented: navigation/.test(err.message)) return;
  console.error(err.stack || err.message);
});

const vm = require('node:vm');
const dom = new JSDOM(html.replace(/<script src="[^"]*"><\/script>/g, ''), {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'file://' + dir + '/',
  virtualConsole,
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
  run('designer-util.js');
  run('designer-content.js');
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
  // Search, filter and re-theme (designer-ux 4.2). None of this was covered
  // before, which is why the section could not safely be moved out of the
  // 6,000-line shell — the logic is unit-tested now, this proves it is wired.
  const shown = () => Array.from(doc.querySelectorAll('.tpl-card')).map((c) => c.dataset.template);
  const search = doc.getElementById('tplSearch');
  const typeSearch = (v) => {
    search.value = v;
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  typeSearch('فاکتور');
  if (!shown().includes('invoice')) fail('searching for فاکتور did not find the invoice');
  if (shown().includes('menu')) fail('the search matched a template it should not have');
  // the same word spelled with Arabic code points must find it too — the exact
  // case tplNorm exists for, and the one a Persian keyboard produces
  typeSearch('فاكتور');
  if (!shown().includes('invoice')) fail('the Arabic spelling of فاکتور found nothing');
  // and a tag that never appears on screen
  typeSearch('invoice');
  if (!shown().includes('invoice')) fail('searching a latin tag found nothing');
  const emptyShown = () => doc.getElementById('tplEmpty').classList.contains('show');
  typeSearch('قطعاً‌چنین‌قالبی‌نیست');
  if (shown().length) fail('a nonsense query still matched ' + shown().length + ' templates');
  if (!emptyShown()) fail('no empty state for a query that matched nothing');
  if (doc.getElementById('tplCount').textContent.trim() !== 'بدون نتیجه')
    fail('the count did not report an empty result: ' + doc.getElementById('tplCount').textContent);
  typeSearch('');
  if (emptyShown()) fail('the empty state stayed up after the query was cleared');

  // a category filter, and the blank canvas surviving it
  const financeBtn = doc.querySelector('#tplCats [data-cat="finance"]');
  if (!financeBtn) fail('the finance category filter is missing');
  financeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const financeCards = shown();
  if (!financeCards.includes('invoice')) fail('the finance filter hid the invoice');
  if (!financeCards.includes('blank')) fail('the blank canvas was filtered out of a category');
  if (financeCards.includes('menu')) fail('the finance filter kept a non-finance template');
  doc.querySelector('#tplCats [data-cat="all"]').dispatchEvent(
    new window.Event('click', {
      bubbles: true,
    }),
  );
  if (shown().length <= financeCards.length) fail('clearing the category filter showed no more');

  // re-theming redraws the thumbnails rather than serving the cached ones
  const beforeTheme = doc.querySelector('.tpl-card[data-template="invoice"] .tpl-thumb').innerHTML;
  const otherTheme = doc.querySelector('#tplThemes [data-theme][aria-checked="false"]');
  if (!otherTheme) fail('there is no second palette to switch to');
  otherTheme.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.querySelector('.tpl-card[data-template="invoice"] .tpl-thumb').innerHTML === beforeTheme)
    fail('switching palette did not redraw the thumbnails');

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

  // designer-ux ۱.۹ — every toolbox entry must be reachable from Ctrl+K. The
  // hand-kept list had drifted to 9 while the rail grew to 12, hiding the table.
  doc.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
  );
  const railTools = Array.from(doc.querySelectorAll('.toolrail [data-add]'));
  const paletteLabels = Array.from(doc.querySelectorAll('#paletteList li')).map((n) =>
    n.textContent.replace(/\s+/g, ' ').trim(),
  );
  if (!paletteLabels.length) fail('palette listed nothing');
  for (const btn of railTools) {
    const want = btn.getAttribute('aria-label');
    if (!want) fail('toolbox button ' + btn.dataset.add + ' has no aria-label to derive from');
    if (!paletteLabels.some((l) => l.indexOf(want) === 0))
      fail('toolbox entry missing from the palette: ' + want + ' (' + btn.dataset.add + ')');
  }
  // and running one of the previously-missing ones really adds that element.
  // The store is only exposed further down, so this stays on the DOM.
  const beforeTable = doc.querySelectorAll('.el').length;
  const pi = doc.getElementById('paletteInput');
  pi.value = 'افزودن جدول';
  pi.dispatchEvent(new window.Event('input', { bubbles: true }));
  pi.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  if (doc.querySelectorAll('.el').length !== beforeTable + 1)
    fail('the palette table command added no element');
  // the designer selects what it just added, so the inspector names its type
  if (!doc.getElementById('inspector').innerHTML.includes('table'))
    fail('the palette table command added something other than a table');
  doc.getElementById('undo').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (doc.querySelectorAll('.el').length !== beforeTable)
    fail('undo did not remove the palette-added table');

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
    // the review offers the pipeline's payoff, not just a close button (F4.2):
    // one click turns the verify stamp on and hands the document to the download
    const stampBtn = doc.getElementById('cloneStampDownload');
    if (!stampBtn) fail('clone review missing the stamp+download action');
    doc.getElementById('verifyStamp').checked = false;
    stampBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!doc.getElementById('verifyStamp').checked)
      fail('stamp+download did not enable the verify stamp');
    if (doc.getElementById('cloneReview').classList.contains('show'))
      fail('stamp+download did not close the review');

    doc
      .getElementById('closeCloneReview')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    if (doc.getElementById('cloneReview').classList.contains('show'))
      fail('clone review did not close');

    // dropping a PDF on the canvas runs the same pipeline as the file menu
    const dropEvent = new window.Event('drop', { bubbles: true, cancelable: true });
    dropEvent.dataTransfer = {
      files: [{ name: 'dropped.pdf', arrayBuffer: async () => new ArrayBuffer(0) }],
      getData: () => '',
    };
    doc.getElementById('page').dispatchEvent(dropEvent);
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (doc.getElementById('docName').value === 'dropped') break;
    }
    if (doc.getElementById('docName').value !== 'dropped')
      fail('dropping a PDF on the canvas did not clone it: ' + doc.getElementById('docName').value);
    doc
      .getElementById('closeCloneReview')
      .dispatchEvent(new window.Event('click', { bubbles: true }));

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

    // --- responsive inspector drawer (design-review ۲.۱) ---
    // jsdom has no layout engine, so the *geometry* of the breakpoints can only
    // be checked in a real browser. What is testable here is the mechanism the
    // CSS hangs off: the toggle, the scrim, Escape, and aria-expanded.
    const toggle = doc.getElementById('togglePanel');
    const scrim = doc.getElementById('panelScrim');
    if (!toggle) fail('panel toggle missing');
    if (!scrim) fail('panel scrim missing');
    if (toggle.getAttribute('aria-controls') !== 'inspectorPanel')
      fail('panel toggle does not point at the inspector');
    if (doc.body.dataset.panel) fail('drawer should start closed');

    toggle.dispatchEvent(clickEv());
    if (doc.body.dataset.panel !== 'open') fail('toggle did not open the drawer');
    if (toggle.getAttribute('aria-expanded') !== 'true') fail('aria-expanded not set on open');
    scrim.dispatchEvent(clickEv());
    if (doc.body.dataset.panel) fail('scrim did not close the drawer');
    if (toggle.getAttribute('aria-expanded') !== 'false') fail('aria-expanded not cleared');

    toggle.dispatchEvent(clickEv());
    doc.getElementById('closePanel').dispatchEvent(clickEv());
    if (doc.body.dataset.panel) fail('in-drawer close button did not close the drawer');

    toggle.dispatchEvent(clickEv());
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (doc.body.dataset.panel) fail('Escape did not close the drawer');
    // …and Escape must not have cleared the selection on its way out
    toggle.dispatchEvent(clickEv());
    layerFor('sm-1').dispatchEvent(clickEv());
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (doc.body.dataset.panel) fail('Escape did not close the drawer (second pass)');
    if (!doc.querySelector('.el.selected')) fail('Escape closed the drawer AND lost the selection');

    // The drawer is anchored to --topbar-h, which JS refines by measurement when
    // the bar wraps on a phone. jsdom reports offsetHeight 0, so only the static
    // :root fallback is checkable here — the measured path needs a real browser.
    if (!/--topbar-h:\s*\d+px/.test(html)) fail('--topbar-h has no static fallback');

    // the stylesheet must actually carry the breakpoints the drawer relies on
    const css = html;
    for (const q of ['max-width: 1180px', 'max-width: 900px', 'max-width: 620px']) {
      if (!css.includes('@media (' + q + ')')) fail('missing breakpoint: ' + q);
    }
    if (!/@media \(max-width: 900px\)[\s\S]{0,1200}position: fixed/.test(css))
      fail('the tablet breakpoint does not float the inspector');

    // --- inspector layout regressions ---
    // jsdom has no layout engine, so the widths themselves are measured by
    // `inspector-check.html`. What is guardable here is that the two rules those
    // measurements depend on have not been reverted.
    if (!/\.grid2[\s\S]{0,600}grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css))
      fail('the placement grid is back on a bare 1fr, whose auto minimum unequalises the tracks');
    if (!/\.row\s*>\s*label\.chk\s*\{[^}]*flex:\s*1 1 auto/.test(css))
      fail('.chk is back to inheriting the 56px caption column and will wrap its sentence');
    // the lock row really is a label inside a .row — the shape that caused it
    const chkNode = doc.querySelector('#inspector .chk');
    if (!chkNode) fail('lock row missing');
    if (chkNode.tagName !== 'LABEL')
      fail('.chk is no longer a label — recheck the CSS guard above');
    if (!chkNode.closest('.row')) fail('.chk is not inside a .row — recheck the CSS guard above');

    // --- band extent + overflow warning (designer-ux ۰.۱) ---
    // jsdom has no layout engine, so the hatch/boundary *look* needs a browser.
    // What is real here: the geometry the designer writes into the style
    // attributes, the overflow classes, the engine diagnostic, and the one-click fix.
    const bandBox = doc.getElementById('bandBox');
    const bandRest = doc.getElementById('bandRest');
    const overflowBtn = doc.getElementById('overflowInfo');
    const bandLabel = doc.getElementById('bandBoxLabel');
    if (!bandBox || !bandRest || !overflowBtn || !bandLabel) fail('band-extent chrome missing');

    // start from a known band: the first one, emptied, fixed at 60pt
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    const band0 = () => store.getState().bands[0];
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(P.patchBand(band0().id, { height: { mode: 'fixed', value: 60 } }));
    const mkText = (id, y) => ({
      id,
      type: 'staticText',
      bounds: { x: 0, y, width: 120, height: 14 },
      zIndex: 1,
      text: id,
      typography: { fontFamily: 'Vazirmatn', fontSize: 10 },
    });
    store.dispatch(P.addElement(band0().id, mkText('ov-in', 4)));

    if (!overflowBtn.hidden) fail('overflow warning shown while the content fits');
    if (bandBox.classList.contains('is-overflow')) fail('band box flagged while content fits');
    // the band box must cover the band's strip, not the whole sheet
    const zoomNow = parseFloat(doc.getElementById('zoomLabel').textContent) / 100;
    if (Math.abs(parseFloat(bandBox.style.height) - 60 * zoomNow) > 1)
      fail('band box height is not the band height: ' + bandBox.style.height);
    if (!/^\d+pt$/.test(bandLabel.textContent))
      fail('band label is not a Latin-digit pt readout: ' + bandLabel.textContent);
    // 0.1 hatched everything below the active band, because the canvas showed
    // one band on an empty sheet. Since 2.1 the sheet carries the whole stack,
    // so hatching "the rest" would grey out the document itself.
    if (bandRest.style.display !== 'none')
      fail('the rest of the sheet is still hatched now that every band is drawn');

    // now push an element past the band edge — the silent bug from the review
    store.dispatch(P.addElement(band0().id, mkText('ov-out', 200)));
    if (overflowBtn.hidden) fail('band overflow went unreported');
    if (!/سرریز باند/.test(overflowBtn.textContent)) fail('overflow button has no message');
    if (!/\d+pt/.test(overflowBtn.textContent))
      fail('overflow amount missing: ' + overflowBtn.textContent);
    if (!bandBox.classList.contains('is-overflow')) fail('band boundary not marked as overflowing');
    const overlayFor = (id) => doc.querySelector('.el[data-id="' + id + '"]');
    if (!overlayFor('ov-out') || !overlayFor('ov-out').classList.contains('is-overflow'))
      fail('the overflowing element is not flagged on the canvas');
    if (overlayFor('ov-in').classList.contains('is-overflow'))
      fail('an element inside the band was wrongly flagged');

    // the engine must say so too — that is what protects renderToFile() users
    const engDiag = P.layoutDocument(store.getState(), { data: {} }).diagnostics;
    if (!engDiag.some((d) => /the overflow is painted over/.test(d.message)))
      fail('the engine did not diagnose the band overflow');

    // one click grows the band to fit, as a single undoable step
    overflowBtn.dispatchEvent(clickEv());
    const grown = band0().height;
    if (grown.mode !== 'fixed' || grown.value < 214)
      fail('fix-it did not grow the band: ' + JSON.stringify(grown));
    if (!overflowBtn.hidden) fail('overflow warning survived the fix');
    if (overlayFor('ov-out').classList.contains('is-overflow'))
      fail('element still flagged after the band grew');
    store.undo();
    if (band0().height.value !== 60)
      fail('fix-it is not one undo step: ' + JSON.stringify(band0().height));
    if (overflowBtn.hidden) fail('undo did not bring the warning back');

    // --- canvas render failure is reported, not silent (designer-ux ۰.۲) ---
    // A chart element with no `series` throws straight out of layoutDocument —
    // exactly the shape a JSON import or a copilot answer can produce. Before
    // this, the sheet just went blank.
    const canvasErr = doc.getElementById('canvasError');
    const canvasErrDetail = doc.getElementById('canvasErrorDetail');
    const canvasErrUndo = doc.getElementById('canvasErrorUndo');
    if (!canvasErr || !canvasErrDetail || !canvasErrUndo) fail('canvas error bar missing');
    if (!canvasErr.hidden) fail('canvas error bar shown while the canvas renders fine');
    if (canvasErr.getAttribute('role') !== 'alert') fail('canvas error bar is not an alert');

    store.dispatch(
      P.addElement(band0().id, {
        id: 'boom',
        type: 'chart',
        bounds: { x: 0, y: 0, width: 100, height: 60 },
        zIndex: 1,
        chartKind: 'column',
        dataset: 'items',
        categories: { source: 'name' },
        // no `series` — layout throws on it
      }),
    );
    if (canvasErr.hidden) fail('a throwing template left the canvas blank and silent');
    if (!canvasErrDetail.textContent.trim()) fail('canvas error carries no detail');
    if (canvasErrUndo.hidden) fail('canvas error offers no way back');
    if (doc.querySelector('#pageSvg svg')) fail('broken layout still painted an svg');

    // the way back actually works, and the bar clears itself
    canvasErrUndo.dispatchEvent(clickEv());
    if (P.findElement(store.getState(), 'boom')) fail('undo from the error bar did nothing');
    if (!canvasErr.hidden) fail('canvas error bar survived the fix');
    if (!doc.querySelector('#pageSvg svg')) fail('canvas did not come back after undo');

    // --- text that outgrows its box (designer-ux ۰.۴) ---
    // The engine measures, wraps and paints every line, so a long string in a
    // short box lands outside it. The overlay must keep the *editable* bounds
    // (drag/resize write those back) and show the spill separately.
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(P.patchBand(band0().id, { height: { mode: 'fixed', value: 400 } }));
    store.dispatch(
      P.addElement(band0().id, {
        id: 'tight',
        type: 'staticText',
        bounds: { x: 0, y: 0, width: 80, height: 14 },
        zIndex: 1,
        text: 'این یک متن خیلی خیلی طولانی است که قطعا در این جعبهٔ کوچک جا نمی‌شود',
        typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
      }),
    );
    const tightNode = () => doc.querySelector('.el[data-id="tight"]');
    if (!tightNode()) fail('the long-text element got no overlay');
    if (!tightNode().classList.contains('is-clipped'))
      fail('text spilling out of its box is not flagged');
    const ghost = tightNode().querySelector('.el-clip-ghost');
    if (!ghost) fail('no ghost showing how far the text actually paints');
    if (!(parseFloat(ghost.style.height) > 0)) fail('ghost has no height: ' + ghost.style.height);
    // the overlay itself must NOT have been stretched — the handles control the box
    if (Math.abs(parseFloat(tightNode().style.height) - 14 * zoomNow) > 1)
      fail('the overlay was stretched instead of ghosting: ' + tightNode().style.height);

    // selecting it surfaces the fix in the inspector
    tightNode().dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    const fitBtn = doc.querySelector('#inspector [data-fit-h]');
    if (!fitBtn) fail('no fit-to-text button for a clipped element');
    const warnRow = doc.querySelector('#inspector .warn-row');
    if (!warnRow || !/بیرون زده/.test(warnRow.textContent))
      fail('inspector does not explain the spill');
    const wanted = Number(fitBtn.dataset.fitH);
    if (!(wanted > 14)) fail('fit target is not taller than the box: ' + wanted);

    // one click fits the box to the text, undoably, and the flag clears
    fitBtn.dispatchEvent(clickEv());
    const fitted = P.findElement(store.getState(), 'tight').element.bounds;
    if (fitted.height !== wanted) fail('fit did not set the height: ' + JSON.stringify(fitted));
    if (fitted.width !== 80) fail('fit changed the width too: ' + JSON.stringify(fitted));
    if (tightNode().classList.contains('is-clipped')) fail('still flagged after fitting');
    if (doc.querySelector('#inspector [data-fit-h]')) fail('fit button survived the fix');
    store.undo();
    if (P.findElement(store.getState(), 'tight').element.bounds.height !== 14)
      fail('fit is not one undo step');
    if (!tightNode().classList.contains('is-clipped')) fail('undo did not restore the flag');

    // --- live diagnostics (designer-ux ۰.۳) ---
    // These used to appear only after "download PDF". They are debounced by
    // 150ms, so every assertion below waits the timer out rather than polling.
    const settle = () => new Promise((r) => setTimeout(r, 260));
    const diagInfo = doc.getElementById('diagInfo');
    const diagList = doc.getElementById('diag');
    if (!diagInfo || !diagList) fail('diagnostics chrome missing');

    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(P.patchBand(band0().id, { height: { mode: 'fixed', value: 200 } }));
    await settle();
    if (!diagInfo.hidden) fail('diagnostics counter shown on a clean document');
    if (diagList.querySelector('.dg-row')) fail('diagnostics listed on a clean document');

    // a mistyped binding: `sum(` never parses, so the engine reports an error
    store.dispatch(
      P.addElement(band0().id, {
        id: 'badbind',
        type: 'dataField',
        bounds: { x: 0, y: 0, width: 120, height: 16 },
        zIndex: 1,
        value: { source: 'sum(' },
        typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
      }),
    );
    await settle();
    if (diagInfo.hidden) fail('a broken binding did not light up the counter');
    if (!/\d/.test(diagInfo.textContent)) fail('counter has no count: ' + diagInfo.textContent);
    const rows = () => Array.from(diagList.querySelectorAll('.dg-row'));
    if (!rows().length) fail('diagnostics list stayed empty');
    if (!rows().some((r) => /sev-error/.test(r.className)))
      fail('a parse error was not reported as an error');
    if (!diagInfo.classList.contains('has-error')) fail('counter does not show the error severity');

    // designer-ux ۰.۶: the engine names the element outright now, so the jump
    // rests on a real field rather than on parsing the message
    const engDiags = P.layoutDocument(store.getState(), { data: {} }).diagnostics;
    const tagged = engDiags.find((d) => d.elementId === 'badbind');
    if (!tagged) fail('the engine diagnostic does not carry elementId');
    if (!tagged.source) fail('elementId replaced source instead of joining it');

    // the row traces back to the element, and the jump selects it
    const goto = diagList.querySelector('.dg-goto');
    if (!goto) fail('no jump button for a diagnostic that names an expression');
    // dispatching addElement straight at the store never touched the selection,
    // so this element being selected afterwards can only be the jump's doing
    if (doc.querySelector('.el[data-id="badbind"].selected'))
      fail('the element was already selected — the jump assertion proves nothing');
    goto.dispatchEvent(clickEv());
    if (!doc.querySelector('.el[data-id="badbind"].selected'))
      fail('jumping from the diagnostic did not select the element');

    // clicking the counter reveals the list on the data tab
    doc.querySelector('.tab[data-tab="design"]').dispatchEvent(clickEv());
    diagInfo.dispatchEvent(clickEv());
    if (!doc.querySelector('.tab[data-tab="data"]').classList.contains('active'))
      fail('the counter did not reveal the data tab');

    // diagnostics are whole-document, not just the active band: park the broken
    // field in a second band and keep editing the first one
    store.dispatch(
      P.addBand(
        {
          id: 'band-diag',
          type: 'reportFooter',
          height: { mode: 'fixed', value: 40 },
          elements: [],
        },
        store.getState().bands.length,
      ),
    );
    const other = store.getState().bands.length - 1;
    store.dispatch(P.removeElementById('badbind'));
    store.dispatch(
      P.addElement(store.getState().bands[other].id, {
        id: 'badbind2',
        type: 'dataField',
        bounds: { x: 0, y: 0, width: 120, height: 16 },
        zIndex: 1,
        value: { source: 'sum(' },
        typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
      }),
    );
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    await settle();
    if (diagInfo.hidden)
      fail('a diagnostic in another band was invisible while editing band 0 — the whole point');
    // and the jump crosses bands
    const goto2 = diagList.querySelector('.dg-goto');
    if (!goto2) fail('no jump button for the cross-band diagnostic');
    goto2.dispatchEvent(clickEv());
    if (!doc.querySelector('.el[data-id="badbind2"].selected'))
      fail('jumping did not switch bands to reach the element');

    // invalid sample JSON reports itself instead of leaving stale diagnostics
    const sampleBox = doc.getElementById('sampleData');
    const goodJson = sampleBox.value;
    sampleBox.value = '{ oops';
    sampleBox.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (!/نامعتبر/.test(diagList.textContent)) fail('invalid sample JSON was not reported');
    sampleBox.value = goodJson;
    sampleBox.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle();

    // --- typography panel (designer-ux ۱.۱) ---
    // Only properties both painters actually render are exposed; italic,
    // underline, line-height and kashida justification were all measured first.
    // the diagnostics section above jumped to another band; come back first, or
    // the element gets no overlay to select
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(P.patchBand(band0().id, { height: { mode: 'fixed', value: 300 } }));
    store.dispatch(
      P.addElement(band0().id, {
        id: 'typo',
        type: 'staticText',
        bounds: { x: 0, y: 0, width: 150, height: 120 },
        zIndex: 1,
        text: 'این یک متن آزمایشی فارسی است که باید در عرض کم به چند خط بشکند',
        typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
      }),
    );
    doc
      .querySelector('.el[data-id="typo"]')
      .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    const typoOf = () => P.findElement(store.getState(), 'typo').element.typography || {};
    const flipTypo = (prop) => {
      const inp = doc.querySelector('#inspector [data-prop="' + prop + '"]');
      if (!inp) fail('typography control missing: ' + prop);
      inp.checked = !inp.checked;
      inp.dispatchEvent(new window.Event('change', { bubbles: true }));
    };

    flipTypo('italic');
    if (typoOf().fontStyle !== 'italic') fail('italic toggle did not write fontStyle');
    flipTypo('underline');
    if (typoOf().decoration !== 'underline') fail('underline toggle did not write decoration');
    flipTypo('bold');
    if (typoOf().fontWeight !== 'bold') fail('bold toggle regressed');

    // designer-ux ۱.۱۰ — `decoration` holds ONE value, so the two switches are
    // mutually exclusive: turning either on replaces the other, and turning the
    // active one off clears it.
    flipTypo('strike');
    if (typoOf().decoration !== 'line-through') fail('strike toggle did not write decoration');
    flipTypo('underline'); // renders unchecked while strike is on, so this turns it ON
    if (typoOf().decoration !== 'underline')
      fail('underline did not replace line-through: ' + typoOf().decoration);
    flipTypo('underline'); // now checked, so this turns it OFF
    if (typoOf().decoration !== 'none')
      fail('turning the active decoration off did not clear it: ' + typoOf().decoration);
    // designer-ux ۱.۱۳ — blank/zero must clear the key, not store a zero
    const lsInp = doc.querySelector('#inspector [data-prop="letterSpacing"]');
    if (!lsInp) fail('letter-spacing control missing');
    lsInp.value = '2.5';
    lsInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (typoOf().letterSpacing !== 2.5)
      fail('letter spacing not written: ' + typoOf().letterSpacing);
    lsInp.value = '0';
    lsInp.dispatchEvent(new window.Event('change', { bubbles: true }));
    if ('letterSpacing' in typoOf()) fail('zero letter spacing should clear the key');

    const vaSel = doc.querySelector('#inspector [data-prop="verticalAlign"]');
    if (!vaSel) fail('vertical-align control missing');
    vaSel.value = 'middle';
    vaSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (typoOf().verticalAlign !== 'middle') fail('vertical align did not apply');

    // line height: blank must clear rather than store 0
    const lh = doc.querySelector('#inspector [data-prop="lineHeight"]');
    if (!lh) fail('line-height control missing');
    lh.value = '2';
    lh.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (typoOf().lineHeight !== 2) fail('line height did not apply: ' + typoOf().lineHeight);
    lh.value = '';
    lh.dispatchEvent(new window.Event('change', { bubbles: true }));
    if ('lineHeight' in typoOf())
      fail('clearing line height stored a value instead of removing it');

    // justify is the headline: it must reach the engine AND insert kashida
    const alignSel = doc.querySelector('#inspector [data-prop="align"]');
    if (!alignSel) fail('align control missing');
    if (!Array.from(alignSel.options).some((o) => o.value === 'justify'))
      fail('align control offers no justify — the kashida feature stays unreachable');
    alignSel.value = 'justify';
    alignSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (typoOf().align !== 'justify') fail('justify did not apply');
    const laid = P.layoutDocument(store.getState(), { data: {} }).pages[0].elements.find(
      (e) => e.id === 'typo',
    );
    const tatweel = (laid.lines || []).join('').match(/ـ/g) || [];
    if (!tatweel.length) fail('justify produced no kashida — the control would be decorative');
    // and the inspector explains where it does and does not show up
    if (!/کشیده/.test(doc.getElementById('inspector').textContent))
      fail('no hint explaining that justify needs multi-line Persian text');
    store.undo();

    // --- box & border panel (designer-ux ۱.۲) ---
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(
      P.addElement(band0().id, {
        id: 'boxy',
        type: 'rectangle',
        bounds: { x: 0, y: 0, width: 120, height: 60 },
        zIndex: 1,
        // seeded so the panel has to round-trip it rather than drop it
        box: { padding: { top: 4, right: 4, bottom: 4, left: 4 } },
      }),
    );
    doc
      .querySelector('.el[data-id="boxy"]')
      .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    const boxOf = () => P.findElement(store.getState(), 'boxy').element.box || {};
    const ctl = (p) => {
      const i = doc.querySelector('#inspector [data-prop="' + p + '"]');
      if (!i) fail('box control missing: ' + p);
      return i;
    };
    const setCtl = (p, v) => {
      const i = ctl(p);
      if (i.type === 'checkbox') i.checked = v;
      else i.value = String(v);
      i.dispatchEvent(new window.Event('change', { bubbles: true }));
    };

    // width alone is enough: the sides default to all four, and four collapse to
    // `all` — the only form that can be stroked as one rectangle and take a radius
    setCtl('boxBorderWidth', 2);
    setCtl('boxBorderStyle', 'dashed');
    let bd = boxOf().border || {};
    if (!bd.all)
      fail('a width with no explicit sides did not produce a border: ' + JSON.stringify(bd));
    if (bd.all.style !== 'dashed') fail('border style not written');
    if (bd.all.width !== 2) fail('border width not written');

    // dropping one edge switches to the per-side shape
    setCtl('boxSide-left', false);
    bd = boxOf().border || {};
    if (bd.all) fail('three sides still collapsed to `all`');
    if (!bd.top || !bd.right || !bd.bottom)
      fail('per-side border not written: ' + JSON.stringify(bd));
    if (bd.left) fail('an unchecked side was still written');
    if (bd.top.style !== 'dashed') fail('per-side border lost its style');
    setCtl('boxSide-left', true);
    if (!(boxOf().border || {}).all) fail('restoring the fourth side did not collapse to `all`');

    setCtl('boxRadius', 8);
    if ((boxOf().border || {}).radius !== 8) fail('radius not written');
    setCtl('boxOpacity', 40);
    if (boxOf().opacity !== 0.4) fail('opacity not written as a 0..1 fraction: ' + boxOf().opacity);
    setCtl('boxFillOn', true);
    if (!boxOf().fill) fail('fill toggle did not add a fill');
    setCtl('boxFillOn', false);
    if (boxOf().fill) fail('fill toggle did not remove the fill');

    // rebuilding from the panel must not lose what the panel does not touch
    if (!boxOf().padding) fail('editing the box dropped padding from the element');

    // designer-ux ۱.۱۱ — padding is a real control now, and reaches the engine
    setCtl('boxPadding', 12);
    const padNow = boxOf().padding;
    if (!padNow || padNow.top !== 12 || padNow.left !== 12)
      fail('padding control did not write all four sides: ' + JSON.stringify(padNow));
    setCtl('boxPadding', 0);
    if (boxOf().padding) fail('zero padding should clear the key, not store zeros');

    // zero width clears the border but keeps the radius the model allows
    setCtl('boxBorderWidth', 0);
    bd = boxOf().border || {};
    if (bd.all) fail('zero width left a border behind');
    if (bd.radius !== 8) fail('zero width also lost the radius');

    // and it really reaches the PDF, not just the model (the divergence fixed here)
    setCtl('boxBorderWidth', 1);
    const withRadius = await P.renderToPdf(store.getState(), { data: {} });
    setCtl('boxRadius', 0);
    const noRadius = await P.renderToPdf(store.getState(), { data: {} });
    if (Buffer.from(withRadius.bytes).equals(Buffer.from(noRadius.bytes)))
      fail('corner radius made no difference to the PDF');

    // --- embedded image upload (designer-ux ۱.۳) ---
    // Only PNG/JPEG go in, because those are the two the PDF painter can embed
    // (SVG resolves in the SVG painter and fails in the PDF one — measured).
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    const PNG_1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const fakeFile = (name, type) => {
      // jsdom's File is fine; FileReader is what needs the bytes
      const f = new window.File([Buffer.from(PNG_1x1, 'base64')], name, { type });
      return f;
    };
    const dropOn = (file) => {
      const ev = new window.Event('drop', { bubbles: true, cancelable: true });
      ev.dataTransfer = { files: [file], getData: () => '' };
      doc.getElementById('page').dispatchEvent(ev);
    };

    // an SVG is refused with a reason instead of silently failing at print time
    const beforeSvg = band0().elements.length;
    dropOn(fakeFile('logo.svg', 'image/svg+xml'));
    await new Promise((r) => setTimeout(r, 400));
    if (band0().elements.length !== beforeSvg) fail('an SVG drop created an element anyway');

    // a PNG becomes an embedded resource plus an element, in one undo step
    dropOn(fakeFile('logo.png', 'image/png'));
    // the importer waits up to 250ms for an intrinsic-size probe that jsdom
    // never resolves, then proceeds without it
    await new Promise((r) => setTimeout(r, 400));
    const imgEl = band0().elements.filter((e) => e.type === 'image')[0];
    if (!imgEl) fail('dropping a PNG did not add an image element');
    if (!imgEl.resourceId) fail('the image element has no resourceId — it is not embedded');
    const resources = () => store.getState().resources.images;
    const res = resources().filter((r) => r.id === imgEl.resourceId)[0];
    if (!res) fail('the image bytes were not stored in resources.images');
    if (res.mime !== 'image/png') fail('wrong mime recorded: ' + res.mime);
    if (!res.data || res.data.length < 20) fail('the resource carries no base64 payload');
    if (imgEl.source) fail('an embedded image should not also carry a URL source');
    // this drop carried no coordinates, so placement must fall back rather than
    // write NaN bounds that only blow up inside the PDF writer much later
    const b = imgEl.bounds;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite))
      fail('a drop without coordinates produced non-finite bounds: ' + JSON.stringify(b));

    // and it really embeds in the PDF, which is the whole point of doing it this way
    const pdfBytes = Buffer.from((await P.renderToPdf(store.getState(), { data: {} })).bytes);
    if (!pdfBytes.toString('latin1').includes('/Subtype /Image'))
      fail('the embedded image did not reach the PDF as an image XObject');

    // one undo removes both the element and the bytes
    store.undo();
    if (band0().elements.some((e) => e.type === 'image')) fail('undo left the image element');
    if (resources().length !== 0) fail('undo left the image bytes behind: ' + resources().length);

    // --- font manager (designer-ux ۱.۴) ---
    const fontList = doc.getElementById('fontList');
    if (!fontList) fail('font list missing');
    if (!/Vazirmatn/.test(fontList.textContent))
      fail('the empty font list does not name the bundled family');

    // upload a font: the family becomes selectable and the bytes ride along
    const TTF = readFileSync(
      join(dir, '../../../packages/pdf-studio/pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf'),
    );
    window.prompt = () => 'IRANSans';
    const fontInput = doc.getElementById('fontInput');
    Object.defineProperty(fontInput, 'files', {
      value: [new window.File([TTF], 'IRANSans-Regular.ttf', { type: 'font/ttf' })],
      configurable: true,
    });
    fontInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));

    const fonts = () => store.getState().resources.fonts;
    if (fonts().length !== 1) fail('the font was not added: ' + fonts().length);
    if (fonts()[0].family !== 'IRANSans') fail('wrong family recorded: ' + fonts()[0].family);
    if (!fonts()[0].data || fonts()[0].data.length < 100) fail('the font carries no bytes');
    if (!/IRANSans/.test(fontList.textContent)) fail('the font list does not show it');

    // the canvas needs an @font-face or it previews a fallback while the PDF
    // prints the real face — the divergence this designer exists to avoid
    const faceStyle = doc.getElementById('templateFontFaces');
    if (!faceStyle) fail('no @font-face block was injected for the embedded font');
    if (!/@font-face/.test(faceStyle.textContent) || !/IRANSans/.test(faceStyle.textContent))
      fail('the @font-face block does not declare the uploaded family');

    // and it is selectable on a text element
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(
      P.addElement(band0().id, {
        id: 'fonted',
        type: 'staticText',
        bounds: { x: 0, y: 0, width: 200, height: 20 },
        zIndex: 1,
        text: 'نمونه',
        typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
      }),
    );
    doc
      .querySelector('.el[data-id="fonted"]')
      .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    const famSel = doc.querySelector('#inspector [data-prop="fontFamily"]');
    if (!famSel) fail('no font-family control on a text element');
    if (!Array.from(famSel.options).some((o) => o.value === 'IRANSans'))
      fail('the uploaded family is not offered in the inspector');
    famSel.value = 'IRANSans';
    famSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (P.findElement(store.getState(), 'fonted').element.typography.fontFamily !== 'IRANSans')
      fail('picking the family did not write it to the element');

    // the whole point: the template alone must print with that font
    const fontedPdf = await P.renderToPdf(store.getState(), { data: {} });
    if (fontedPdf.diagnostics.some((d) => /with the selected font/.test(d.message)))
      fail('the embedded font did not reach the PDF — text fell back and failed to encode');

    // removing it is undoable
    doc.querySelector('#fontList .st-del').dispatchEvent(clickEv());
    if (fonts().length !== 0) fail('removing the font did nothing');
    store.undo();
    if (fonts().length !== 1) fail('undo did not restore the font');

    // --- page setup: margins, unit, locale (designer-ux ۱.۵/۱.۶/۱.۷) ---
    const pageOf = () => store.getState().page;
    const setVal = (id, v) => {
      const i = doc.getElementById(id);
      if (!i) fail('page control missing: ' + id);
      i.value = String(v);
      i.dispatchEvent(new window.Event('change', { bubbles: true }));
    };

    // 1.5 — margins were honoured by the engine and settable by nothing
    doc.getElementById('mgLink').checked = true;
    setVal('mgTop', 40);
    if (
      JSON.stringify(pageOf().margins) !==
      JSON.stringify({ top: 40, right: 40, bottom: 40, left: 40 })
    )
      fail('linked margins did not apply to all four: ' + JSON.stringify(pageOf().margins));
    doc.getElementById('mgLink').checked = false;
    setVal('mgLeft', 12);
    if (pageOf().margins.left !== 12) fail('unlinked margin did not apply');
    if (pageOf().margins.top !== 40) fail('unlinked margin changed a side it should not have');
    // and the content really moves
    const laidX = P.layoutDocument(store.getState(), { data: {} }).pages[0].elements[0].bounds.x;
    if (laidX !== 12) fail('the margin did not move the content: x=' + laidX);

    // 1.6 — the unit is display-only: the model must still hold points
    setVal('pageUnit', 'mm');
    if (pageOf().unit !== 'mm') fail('unit not stored');
    if (pageOf().margins.left !== 12)
      fail('switching units rewrote the stored points: ' + pageOf().margins.left);
    // 12pt ≈ 4.2mm, so the field must now read millimetres, not 12
    const mgLeftShown = Number(doc.getElementById('mgLeft').value);
    if (Math.abs(mgLeftShown - 12 * (25.4 / 72)) > 0.11)
      fail('the margin field did not convert to mm: ' + mgLeftShown);
    // typing in mm stores the equivalent points
    setVal('mgLeft', 10);
    if (Math.abs(pageOf().margins.left - 10 / (25.4 / 72)) > 0.01)
      fail('a millimetre entry was stored as points wrongly: ' + pageOf().margins.left);
    // element geometry follows the same unit
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    const anyEl = doc.querySelector('.el');
    anyEl.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    if (!/mm/.test(doc.getElementById('inspector').textContent))
      fail('the placement section does not name the active unit');
    setVal('pageUnit', 'pt');

    // 1.7 — digits and calendar both measurably change the output, and each
    // control must leave the other alone (they share one `locale` object)
    setVal('pageCalendar', 'jalali');
    const calBefore = pageOf().locale.calendar;
    setVal('pageDigits', 'latn');
    if (pageOf().locale.digits !== 'latn') fail('digits not stored');
    if (pageOf().locale.calendar !== calBefore) fail('changing digits clobbered the calendar');
    setVal('pageCalendar', 'gregorian');
    if (pageOf().locale.calendar !== 'gregorian') fail('calendar not stored');
    if (pageOf().locale.digits !== 'latn') fail('changing the calendar clobbered the digits');
    // and it reaches the output, not just the model
    const dated = P.layoutDocument(
      {
        ...store.getState(),
        bands: [
          {
            id: 'dt',
            type: 'reportHeader',
            height: { mode: 'fixed', value: 40 },
            elements: [
              {
                id: 'd',
                type: 'pageField',
                bounds: { x: 0, y: 0, width: 200, height: 16 },
                zIndex: 1,
                field: 'currentDate',
              },
            ],
          },
        ],
      },
      { data: {}, now: Date.parse('2026-07-30T00:00:00Z') },
    ).pages[0].elements[0].text;
    if (!/^2026/.test(String(dated)))
      fail('gregorian + latin digits did not reach the rendered date: ' + dated);

    // --- eight resize grips + rotation (designer-ux ۱.۸) ---
    // 1:1 first: pointer deltas are divided by the zoom, and an earlier section
    // left it at 95%, which would make every expected number fractional
    doc.getElementById('zoomReset').dispatchEvent(clickEv());
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(P.patchPageSetup({ margins: { top: 0, right: 0, bottom: 0, left: 0 } }));
    store.dispatch(
      P.addElement(band0().id, {
        id: 'grip',
        type: 'rectangle',
        bounds: { x: 100, y: 100, width: 100, height: 50 },
        zIndex: 1,
        box: { fill: { color: { space: 'rgb', r: 0.5, g: 0.5, b: 0.5 } } },
      }),
    );
    const gripNode = () => doc.querySelector('.el[data-id="grip"]');
    gripNode().dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const d of dirs) {
      if (!gripNode().querySelector('.handle.h-' + d)) fail('missing resize grip: ' + d);
    }
    if (!gripNode().querySelector('.rot-handle')) fail('missing rotation grip');

    const boundsOfGrip = () => P.findElement(store.getState(), 'grip').element.bounds;
    /** Drag one grip by a screen delta; Alt suppresses snapping so the maths is exact. */
    const dragGrip = (dir, dx, dy, opts) => {
      const h = gripNode().querySelector('.handle.h-' + dir);
      h.dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
      );
      window.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          clientX: dx,
          clientY: dy,
          altKey: true,
          ...(opts || {}),
        }),
      );
      window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    };

    // the south-east grip is the old behaviour: only width/height grow
    dragGrip('se', 20, 10);
    let gb = boundsOfGrip();
    if (gb.x !== 100 || gb.y !== 100) fail('se grip moved the origin: ' + JSON.stringify(gb));
    if (Math.round(gb.width) !== 120 || Math.round(gb.height) !== 60)
      fail('se grip did not resize: ' + JSON.stringify(gb));
    store.undo();

    // the north-west grip must move the origin and shrink, not move the box
    dragGrip('nw', 20, 10);
    gb = boundsOfGrip();
    if (Math.round(gb.x) !== 120 || Math.round(gb.y) !== 110)
      fail('nw grip did not drag the top-left corner: ' + JSON.stringify(gb));
    if (Math.round(gb.width) !== 80 || Math.round(gb.height) !== 40)
      fail('nw grip did not shrink the box: ' + JSON.stringify(gb));
    store.undo();

    // an edge grip drives one axis only
    dragGrip('e', 30, 30);
    gb = boundsOfGrip();
    if (Math.round(gb.width) !== 130) fail('east grip did not widen: ' + JSON.stringify(gb));
    if (Math.round(gb.height) !== 50)
      fail('east grip changed the height too: ' + JSON.stringify(gb));
    store.undo();

    dragGrip('n', 30, 20);
    gb = boundsOfGrip();
    if (Math.round(gb.y) !== 120 || Math.round(gb.height) !== 30)
      fail('north grip did not drag the top edge: ' + JSON.stringify(gb));
    if (Math.round(gb.x) !== 100 || Math.round(gb.width) !== 100)
      fail('north grip touched the horizontal axis: ' + JSON.stringify(gb));
    store.undo();

    // a grip can never invert the box through its opposite edge
    dragGrip('e', -500, 0);
    gb = boundsOfGrip();
    if (gb.width < 8) fail('the box collapsed past its minimum: ' + JSON.stringify(gb));
    if (gb.width + gb.x < gb.x) fail('the box inverted');
    store.undo();

    // Shift keeps the proportions (100×50 → 2:1)
    dragGrip('se', 60, 0, { shiftKey: true });
    gb = boundsOfGrip();
    if (Math.abs(gb.width / gb.height - 2) > 0.01)
      fail('shift did not preserve the aspect ratio: ' + JSON.stringify(gb));
    store.undo();

    // rotation: drag the grip a quarter turn around the centre
    const rot = gripNode().querySelector('.rot-handle');
    rot.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, clientX: 150, clientY: 0 }),
    );
    window.dispatchEvent(
      new window.MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 125 }),
    );
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    const rotated = P.findElement(store.getState(), 'grip').element.rotation;
    if (!rotated) fail('dragging the rotation grip did not rotate anything');
    if (Math.abs(rotated - 90) > 1) fail('a quarter turn should be ~90°, got ' + rotated);
    // the overlay must follow, or the selection box sits where nothing is painted
    if (!/rotate\(/.test(gripNode().style.transform))
      fail('the overlay does not mirror the rotation');
    store.undo();
    if (P.findElement(store.getState(), 'grip').element.rotation) fail('rotation is not undoable');

    // --- canvas and paper measure with the same font (designer-ux ۱.۱۲) ---
    // The engine now measures with real metrics when it holds the bytes. The
    // canvas, the preview and the PDF must therefore all be handed the same
    // list, or the screen would break lines where the paper does not.
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    const wrapping = {
      id: 'wrap',
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 140, height: 20 },
      zIndex: 1,
      text: 'این یک متن فارسی برای سنجش محل شکست خط است',
      typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
    };
    store.dispatch(P.addElement(band0().id, wrapping));

    const withFonts = P.layoutDocument(
      store.getState(),
      { data: {} },
      // designer.js keeps its own decoder inside the closure, so decode here
      {
        pdf: {
          fonts: [{ family: 'Vazirmatn', bytes: Buffer.from(window.VAZIRMATN_BASE64, 'base64') }],
        },
      },
    ).pages[0].elements.find((e) => e.id === 'wrap');
    const withoutFonts = P.layoutDocument(
      store.getState(),
      { data: {} },
      {},
    ).pages[0].elements.find((e) => e.id === 'wrap');
    if (withFonts.lines.length === withoutFonts.lines.length)
      fail('the fixture no longer distinguishes the two measurers — pick a narrower box');

    // The canvas paints the whole page now (2.1), so compare against every line
    // that page lays out, not just this element's — and against the real-font
    // layout, since that is what the canvas is claimed to use.
    const linesOn = (d) =>
      d.pages[0].elements.reduce((n, e) => n + (e.lines ? e.lines.length : 0), 0);
    const withFontsDoc = P.layoutDocument(
      store.getState(),
      { data: {} },
      {
        pdf: {
          fonts: [{ family: 'Vazirmatn', bytes: Buffer.from(window.VAZIRMATN_BASE64, 'base64') }],
        },
      },
    );
    const tspans = (doc.querySelector('#pageSvg').innerHTML.match(/<tspan/g) || []).length;
    if (tspans !== linesOn(withFontsDoc))
      fail(
        'the canvas measured with the estimator: ' +
          tspans +
          ' lines drawn, ' +
          linesOn(withFontsDoc) +
          ' expected with the real font',
      );
    if (linesOn(withFontsDoc) === linesOn(P.layoutDocument(store.getState(), { data: {} }, {})))
      fail('the fixture no longer distinguishes the two measurers at page level');

    // --- rulers and manual guides (designer-ux ۲.۲) ---
    const rulerH = doc.getElementById('rulerH');
    const rulerV = doc.getElementById('rulerV');
    if (!rulerH || !rulerV) fail('rulers missing');
    if (!rulerH.querySelectorAll('.tick').length) fail('the top ruler has no ticks');
    if (!rulerV.querySelectorAll('.tick').length) fail('the side ruler has no ticks');
    // zero must sit at the content edge, not the paper edge
    const zeroTick = Array.from(rulerH.querySelectorAll('.tick')).find(
      (t) => t.textContent.trim() === '0',
    );
    if (!zeroTick) fail('the ruler never reaches zero');
    {
      const m = store.getState().page.margins;
      const zoomNow = parseFloat(doc.getElementById('zoomLabel').textContent) / 100;
      const want = Math.round(m.left * zoomNow);
      if (Math.abs(parseFloat(zeroTick.style.left) - want) > 1)
        fail('ruler zero is not at the left margin: ' + zeroTick.style.left + ' want ' + want);
    }

    // drag a guide off the top ruler
    const guideCount = () => doc.querySelectorAll('#page .guide').length;
    if (guideCount() !== 0) fail('guides present before any were drawn');
    const pageRect = doc.getElementById('page').getBoundingClientRect();
    rulerH.dispatchEvent(
      new window.MouseEvent('mousedown', {
        bubbles: true,
        clientX: pageRect.left + 120,
        clientY: pageRect.top,
      }),
    );
    window.dispatchEvent(
      new window.MouseEvent('mousemove', {
        bubbles: true,
        clientX: pageRect.left + 150,
        clientY: pageRect.top + 40,
      }),
    );
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    if (guideCount() !== 1) fail('dragging off the ruler did not create a guide');

    // it snaps: an element dragged near it lands on it
    const stored = JSON.parse(mem.get('pdfstudio.guides') || '{}');
    if (!stored.x || stored.x.length !== 1)
      fail('the guide was not persisted: ' + mem.get('pdfstudio.guides'));
    const guideX = stored.x[0];
    if (!(guideX > 0)) fail('the guide landed at a nonsense position: ' + guideX);

    // dropping one outside the sheet removes it again
    rulerH.dispatchEvent(
      new window.MouseEvent('mousedown', {
        bubbles: true,
        clientX: pageRect.left + 200,
        clientY: pageRect.top,
      }),
    );
    window.dispatchEvent(
      new window.MouseEvent('mousemove', {
        bubbles: true,
        clientX: pageRect.left - 400,
        clientY: pageRect.top,
      }),
    );
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    if (guideCount() !== 1) fail('a guide dropped off the sheet was kept: ' + guideCount());

    // --- configurable grid + live drag readout (designer-ux ۲.۳) ---
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    store.dispatch(
      P.patchPageSetup({ unit: 'pt', margins: { top: 0, right: 0, bottom: 0, left: 0 } }),
    );
    store.dispatch(
      P.addElement(band0().id, {
        id: 'snapme',
        type: 'rectangle',
        bounds: { x: 0, y: 0, width: 40, height: 20 },
        zIndex: 1,
        box: { fill: { color: { space: 'rgb', r: 0.5, g: 0.5, b: 0.5 } } },
      }),
    );
    const gridInput = doc.getElementById('gridStep');
    if (!gridInput) fail('grid control missing');
    const readout = doc.getElementById('dragReadout');
    if (!readout) fail('drag readout missing');
    if (readout.classList.contains('show')) fail('the readout is visible before any drag');

    const dragTo = (x, y) => {
      const node = doc.querySelector('.el[data-id="snapme"]');
      node.dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
      );
      window.dispatchEvent(
        new window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }),
      );
      const shown = readout.classList.contains('show') ? readout.textContent : null;
      window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
      return shown;
    };
    const snapX = () => P.findElement(store.getState(), 'snapme').element.bounds.x;

    // default 5pt grid rounds a 23pt drag to 25
    gridInput.value = '5';
    gridInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    const text = dragTo(23, 0);
    if (!text) fail('the readout did not appear during a drag');
    if (!/x\s|y\s/.test(text)) fail('the readout does not show a position: ' + text);
    if (!/pt/.test(text)) fail('the readout does not name the unit: ' + text);
    if (Math.round(snapX()) !== 25) fail('default grid did not snap to 25: ' + snapX());
    store.undo();

    // a 20pt grid rounds the same drag to 20
    gridInput.value = '20';
    gridInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    dragTo(23, 0);
    if (Math.round(snapX()) !== 20) fail('a 20pt grid did not snap to 20: ' + snapX());
    store.undo();

    // zero means no grid at all: the value passes straight through
    gridInput.value = '0';
    gridInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    dragTo(23, 0);
    if (Math.round(snapX()) !== 23) fail('a zero grid still snapped: ' + snapX());
    store.undo();
    if (mem.get('pdfstudio.grid') !== '0') fail('the grid step was not persisted');

    if (readout.classList.contains('show')) fail('the readout outlived the drag');
    gridInput.value = '5';
    gridInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    // --- page navigation (designer-ux ۲.۴) ---
    const settle24 = () => new Promise((r) => setTimeout(r, 300));
    const pageNav = doc.getElementById('pageNav');
    const pageLabel = doc.getElementById('pageNavLabel');
    if (!pageNav || !pageLabel) fail('page navigation missing');

    // a one-page document has nothing to navigate
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    for (const el of band0().elements.slice()) store.dispatch(P.removeElementById(el.id));
    await settle24();
    if (!pageNav.hidden) fail('page navigation shown for a one-page document');

    // a detail band over enough rows genuinely spills onto more pages
    store.dispatch(
      P.replaceTemplate({
        ...store.getState(),
        datasets: [{ name: 'rows', source: { kind: 'path', path: 'rows' } }],
        bands: [
          {
            id: 'many',
            type: 'detail',
            height: { mode: 'fixed', value: 60 },
            dataset: 'rows',
            elements: [
              {
                id: 'row',
                type: 'staticText',
                bounds: { x: 0, y: 0, width: 200, height: 16 },
                zIndex: 1,
                text: 'ردیف',
                typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
              },
            ],
          },
        ],
      }),
    );
    const many = { rows: Array.from({ length: 40 }, (_, i) => ({ n: i })) };
    doc.getElementById('sampleData').value = JSON.stringify(many);
    doc.getElementById('sampleData').dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle24();

    const realPages = P.layoutDocument(store.getState(), { data: many }, {}).pageCount;
    if (realPages < 2) fail('the fixture did not produce a multi-page document: ' + realPages);
    if (pageNav.hidden) fail('page navigation stayed hidden for a ' + realPages + '-page document');
    if (pageLabel.textContent.trim() !== '1 / ' + realPages)
      fail('wrong page count shown: ' + pageLabel.textContent.trim() + ' want 1 / ' + realPages);
    if (!doc.getElementById('pageNavPrev').disabled) fail('previous is enabled on the first page');
    if (doc.getElementById('pageNavNext').disabled)
      fail('next is disabled while there are pages left');

    // next opens the preview and moves the counter
    doc.getElementById('pageNavNext').dispatchEvent(clickEv());
    if (!doc.getElementById('preview').classList.contains('show'))
      fail('going to a page did not open the preview');
    if (pageLabel.textContent.trim() !== '2 / ' + realPages)
      fail('the counter did not advance: ' + pageLabel.textContent.trim());
    if (doc.getElementById('pageNavPrev').disabled) fail('previous is still disabled on page 2');

    // and it clamps rather than running past the end
    for (let i = 0; i < realPages + 5; i++) {
      doc.getElementById('pageNavNext').dispatchEvent(clickEv());
    }
    if (pageLabel.textContent.trim() !== realPages + ' / ' + realPages)
      fail('the counter ran past the last page: ' + pageLabel.textContent.trim());
    doc.getElementById('togglePreview').dispatchEvent(clickEv());

    // --- the whole page on the canvas (designer-ux ۲.۱) ---
    // The canvas used to draw the active band alone at the top margin, so an
    // element's overlay and the place the engine actually painted it agreed only
    // for the first band on the page. That is the one thing worth asserting: the
    // overlay must land on the painted element, whatever the band stack above it.
    const settle21 = () => new Promise((r) => setTimeout(r, 300));
    store.dispatch(
      P.replaceTemplate({
        ...store.getState(),
        datasets: [{ name: 'rows', source: { kind: 'path', path: 'rows' } }],
        bands: [
          {
            id: 'ph',
            type: 'pageHeader',
            height: { mode: 'fixed', value: 50 },
            elements: [
              {
                id: 'title',
                type: 'staticText',
                bounds: { x: 0, y: 4, width: 200, height: 16 },
                zIndex: 1,
                text: 'سربرگ',
                typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
              },
            ],
          },
          {
            id: 'body',
            type: 'detail',
            height: { mode: 'fixed', value: 40 },
            dataset: 'rows',
            elements: [
              {
                id: 'cell',
                type: 'staticText',
                bounds: { x: 12, y: 6, width: 200, height: 16 },
                zIndex: 1,
                text: 'خانه',
                typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
              },
            ],
          },
        ],
      }),
    );
    const threeRows = { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    doc.getElementById('sampleData').value = JSON.stringify(threeRows);
    doc.getElementById('sampleData').dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#inspector [data-band="1"]').dispatchEvent(clickEv());
    await settle21();

    const laid21 = P.layoutDocument(store.getState(), { data: threeRows }, {}).pages[0];
    if (!laid21.bands || !laid21.bands.length) fail('the engine reported no band strips');
    const headerStrip = laid21.bands.find((b) => b.id === 'ph');
    const bodyStrips = laid21.bands.filter((b) => b.id === 'body');
    if (!headerStrip || bodyStrips.length !== 3)
      fail('fixture did not produce a header + three detail strips');
    // the fixture is only discriminating if the detail does NOT start at the top
    // margin — otherwise the old lone-band positioning would pass unchanged
    if (bodyStrips[0].bounds.y <= headerStrip.bounds.y + 1)
      fail('the detail band starts at the top margin — the fixture proves nothing');

    const painted21 = laid21.elements.find((e) => e.id === 'cell');
    const overlay21 = doc.querySelector('#page .el[data-id="cell"]');
    if (!overlay21) fail('the detail element has no overlay');
    const z21 = parseFloat(doc.getElementById('zoomLabel').textContent) / 100;
    if (Math.abs(parseFloat(overlay21.style.top) - painted21.bounds.y * z21) > 0.5)
      fail(
        'the overlay is not where the engine painted it: top ' +
          overlay21.style.top +
          ' want ' +
          painted21.bounds.y * z21 +
          'px',
      );
    if (Math.abs(parseFloat(overlay21.style.left) - painted21.bounds.x * z21) > 0.5)
      fail('the overlay is not where the engine painted it horizontally: ' + overlay21.style.left);

    // the bands you are not editing are still drawn, so the page reads as a
    // document; the repeats are marked, because editing row 3 edits row 1
    const phStrip = doc.querySelector('#page .band-strip[data-band-strip="ph"]');
    if (!phStrip) fail('the page header band is not drawn on the canvas');
    if (Math.abs(parseFloat(phStrip.style.top) - headerStrip.bounds.y * z21) > 0.5)
      fail('the page header strip is not where the flow placed it: ' + phStrip.style.top);
    const repeats = doc.querySelectorAll('#page .band-strip[data-band-strip="body"]');
    if (repeats.length !== 2)
      fail('want 2 repeat strips for the active band, got ' + repeats.length);
    for (const r of repeats)
      if (!r.classList.contains('is-repeat')) fail('a repeated band strip is not marked as one');
    // and the active band's own first strip stays the editable one
    if (doc.querySelector('#page .band-strip[data-band-strip="body"]:not(.is-repeat)'))
      fail('the active band was drawn twice — as a strip and as the band box');

    // clicking a band on the page starts editing it — the reason the whole
    // document is on screen at all, rather than just being prettier
    phStrip.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    await settle21();
    if (!doc.querySelector('#inspector [data-band="0"]').classList.contains('active'))
      fail('clicking the page header strip did not select that band');
    if (!doc.querySelector('#page .el[data-id="title"]'))
      fail('selecting a band by its strip did not move the overlays to it');
    // a repeat belongs to the same band, so it selects that band too
    doc
      .querySelector('#page .band-strip[data-band-strip="body"]')
      .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    await settle21();
    if (!doc.querySelector('#inspector [data-band="1"]').classList.contains('active'))
      fail('clicking a repeated strip did not select the band it repeats');

    // The canvas draws page `previewPage`, so the page navigation has to redraw
    // it — otherwise it keeps showing whichever page it last happened to render.
    // A report header makes page 1 genuinely differ from page 2: the rows start
    // lower on the first page, so a canvas that did not follow would be caught.
    store.dispatch(
      P.replaceTemplate({
        ...store.getState(),
        bands: [
          {
            id: 'rh',
            type: 'reportHeader',
            height: { mode: 'fixed', value: 120 },
            elements: [],
          },
          store.getState().bands.find((b) => b.id === 'body'),
        ],
      }),
    );
    const manyRows = { rows: Array.from({ length: 40 }, (_, i) => ({ n: i })) };
    doc.getElementById('sampleData').value = JSON.stringify(manyRows);
    doc.getElementById('sampleData').dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#inspector [data-band="1"]').dispatchEvent(clickEv());
    await settle21();

    const paged = P.layoutDocument(store.getState(), { data: manyRows }, {});
    if (paged.pageCount < 2) fail('the page-follow fixture is not multi-page');
    const topOn = (p) => paged.pages[p].bands.find((b) => b.id === 'body').bounds.y;
    if (topOn(0) === topOn(1))
      fail('the fixture pages are identical — a canvas that ignored the page would pass');
    // the band box is where the active band is drawn, so it tracks the page
    const boxTop = () => parseFloat(doc.getElementById('bandBox').style.top);
    if (Math.abs(boxTop() - topOn(0) * z21) > 0.5)
      fail('the canvas is not showing page 1: band box at ' + boxTop());
    doc.getElementById('pageNavNext').dispatchEvent(clickEv());
    await settle21();
    if (Math.abs(boxTop() - topOn(1) * z21) > 0.5)
      fail('the canvas did not follow the page navigation: band box at ' + boxTop());
    doc.getElementById('togglePreview').dispatchEvent(clickEv());

    // --- a gallery template must load without a wall of false warnings ---
    // Vazirmatn's line box at 11pt is 14.1pt, so every 12pt box in the gallery
    // "spilled" by 2pt and the canvas lit up with clip ghosts nobody could act
    // on: a single line is as tall as the font makes it, and no painter clips
    // text to its box. Auto-grow is about text that *wrapped*.
    const receipt = window.PDFSTUDIO_TEMPLATES.find((g) => g.id === 'receipt');
    if (!receipt) fail('the receipt template is gone from the gallery');
    store.dispatch(P.replaceTemplate(JSON.parse(JSON.stringify(receipt.template))));
    doc.getElementById('sampleData').value = JSON.stringify(receipt.data || {});
    doc.getElementById('sampleData').dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    await settle21();

    const els = Array.prototype.slice.call(doc.querySelectorAll('#page .el'));
    if (els.length < 15) fail('the receipt did not load: ' + els.length + ' overlays');
    const clipped = els.filter((n) => n.classList.contains('is-clipped')).map((n) => n.dataset.id);
    if (clipped.length) fail('single-line text flagged as auto-grown: ' + clipped.join(', '));
    // and the ghost is what the flag draws, so it must be gone too
    if (doc.querySelector('#page .el-clip-ghost'))
      fail('a clip ghost was drawn for text that never wrapped');
    // but genuine wrapping must still be caught — the whole point of 0.4.
    // Squeezing an existing line of text into a narrow box makes it wrap without
    // inventing new content.
    const thanks = band0().elements.find((e) => e.id === 'r-thanks');
    if (!thanks) fail('the receipt thank-you line is gone');
    store.dispatch(P.setElementBounds(thanks.id, { ...thanks.bounds, width: 40 }));
    await settle21();
    const wrapped = doc.querySelector('#page .el[data-id="r-thanks"]');
    if (!wrapped.classList.contains('is-clipped'))
      fail('text that wrapped past its box was not flagged');
    if (!wrapped.querySelector('.el-clip-ghost')) fail('wrapped text got no clip ghost');
    store.undo();
    await settle21();
    if (doc.querySelector('#page .el[data-id="r-thanks"]').classList.contains('is-clipped'))
      fail('undo did not clear the wrap');

    // a `currentDate` field renders as today. The engine returns null from
    // `now()` for byte-determinism, so the screen paths have to pin the clock —
    // the PDF export already did, and a canvas that disagrees with the paper is
    // the one thing this tool may not do.
    const dateEl = doc.querySelector('#page .el[data-id="r-date"]');
    if (!dateEl) fail('the receipt date field is gone');
    if (dateEl.classList.contains('is-empty'))
      fail('the date field renders blank on the canvas but not in the PDF');
    if (!/\d|[۰-۹]/.test(doc.querySelector('#pageSvg').textContent))
      fail('no digits painted at all — the date probably did not render');

    // the band fills this 430pt sheet, so its size chip must not hang off the
    // paper — it flips above the band's bottom edge instead
    if (!doc.getElementById('bandBox').classList.contains('is-low'))
      fail('a band ending at the foot of the sheet did not move its chip inside');

    // --- the canvas opens at a size you can work at (fit-to-page) ---
    // jsdom reports 0 for every client dimension, which is exactly the case
    // `fitZoom` refuses to act on — so give the wrap a measurable size to prove
    // the wiring. Everything above this point ran at the unfitted default,
    // which is the guard doing its job.
    const wrap = doc.querySelector('.canvas-wrap');
    const setViewport = (w, h) => {
      Object.defineProperty(wrap, 'clientWidth', { value: w, configurable: true });
      Object.defineProperty(wrap, 'clientHeight', { value: h, configurable: true });
    };
    const zoomNow2 = () => parseFloat(doc.getElementById('zoomLabel').textContent) / 100;
    // fitting ON (that is what the fit button means) but nothing measurable:
    // the zoom must stay put rather than collapse to the 40% floor
    const beforeFit = zoomNow2();
    doc.getElementById('zoomFit').dispatchEvent(clickEv());
    await settle21();
    if (Math.abs(zoomNow2() - beforeFit) > 0.001)
      fail('an unmeasurable viewport changed the zoom: ' + zoomNow2());

    // the receipt is still loaded: 226×430pt in a roomy viewport must scale UP,
    // which is the whole complaint — the editable canvas was smaller than the
    // read-only preview next to it
    setViewport(900, 800);
    doc.getElementById('zoomFit').dispatchEvent(clickEv());
    await settle21();
    const receiptZoom = zoomNow2();
    if (!(receiptZoom > 1))
      fail('an 80mm receipt did not scale up to fill the canvas: ' + receiptZoom);
    if (parseFloat(doc.getElementById('page').style.width) > 900)
      fail('the fitted page is wider than the viewport');

    // a different page size re-fits on its own, without touching the button
    store.dispatch(
      P.replaceTemplate({
        ...store.getState(),
        page: { ...store.getState().page, size: { width: 595, height: 842 } },
      }),
    );
    await settle21();
    const a4Zoom = zoomNow2();
    if (!(a4Zoom < receiptZoom)) fail('an A4 was not fitted smaller than a receipt: ' + a4Zoom);
    if (parseFloat(doc.getElementById('page').style.height) > 800)
      fail('the fitted A4 is taller than the viewport');

    // but a zoom set by hand is never overridden — including by a page change
    doc.getElementById('zoomIn').dispatchEvent(clickEv());
    await settle21();
    const manual = zoomNow2();
    store.dispatch(
      P.replaceTemplate({
        ...store.getState(),
        page: { ...store.getState().page, size: { width: 226, height: 430 } },
      }),
    );
    await settle21();
    if (Math.abs(zoomNow2() - manual) > 0.001)
      fail('the canvas re-fitted over a zoom the user had set: ' + zoomNow2());
    // and asking to fit hands it back
    doc.getElementById('zoomFit').dispatchEvent(clickEv());
    await settle21();
    if (Math.abs(zoomNow2() - receiptZoom) > 0.001)
      fail('the fit button did not restore automatic fitting: ' + zoomNow2());

    // Every backdrop modal must be in the focus trap and the Escape chain. Both
    // are hand-written id lists in designer.js, so a new modal joins them only
    // if someone remembers — this is the thing that remembers.
    const backdrops = Array.from(
      doc.querySelectorAll('.help-backdrop, .gallery-backdrop, .palette-backdrop'),
    ).filter((n) => n.id);
    for (const modal of backdrops) {
      const panel = modal.querySelector('[role="dialog"]');
      if (!panel) fail('modal #' + modal.id + ' has no role="dialog" panel');
      if (panel.getAttribute('aria-modal') !== 'true')
        fail('modal #' + modal.id + ' is not aria-modal');
      modal.classList.add('show');
      // fire from inside the modal, the way a real key press does: some modals
      // (the command palette) listen on their own input rather than on document
      const from = panel.querySelector('input, button') || modal;
      from.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (modal.classList.contains('show')) {
        modal.classList.remove('show');
        fail('modal #' + modal.id + ' does not close on Escape');
      }
    }

    // --- the document library (designer-ux ۲.۵) ---
    // The promise is one sentence: leaving a document is never how you lose it.
    // "New document" used to wipe the draft behind a confirm(), so the only way
    // to start something else was to destroy what you had.
    const settle25 = () => new Promise((r) => setTimeout(r, 500));
    const docsPanel = doc.getElementById('docs');
    const docRows = () => Array.from(doc.querySelectorAll('#docsList .doc-row'));
    const docNames = () => docRows().map((r) => r.querySelector('b').textContent);
    if (!docsPanel) fail('the document library is missing');

    // give the open document a name we can find again, and something in it
    const named = { ...store.getState(), metadata: { name: 'سند الف' } };
    store.dispatch(P.replaceTemplate(named));
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    store.dispatch(P.addElement(band0().id, mkText('keep-me', 40)));
    await settle25();

    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    if (!docsPanel.classList.contains('show')) fail('the library did not open');
    if (!docNames().includes('سند الف')) fail('the open document is not in its own library');
    const current = docRows().find((r) => r.classList.contains('is-current'));
    if (!current) fail('nothing is marked as the document being edited');
    if (current.querySelector('b').textContent !== 'سند الف')
      fail('the wrong row is marked as current');

    // a new document must appear BESIDE the old one, not on top of it
    doc.getElementById('docsNew').dispatchEvent(clickEv());
    await settle25();
    if (P.findElement(store.getState(), 'keep-me'))
      fail('the new document inherited the previous one’s elements');
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    if (!docNames().includes('سند الف')) fail('creating a document destroyed the previous one');
    if (docRows().length < 2) fail('the new document was not added to the library');

    // and going back gets the work back — the acceptance criterion
    const backRow = docRows().find((r) => r.querySelector('b').textContent === 'سند الف');
    backRow.dispatchEvent(clickEv());
    await settle25();
    if (!P.findElement(store.getState(), 'keep-me'))
      fail('switching back did not restore the document’s elements');
    if (store.getState().metadata.name !== 'سند الف')
      fail('switching back opened the wrong document: ' + store.getState().metadata.name);

    // An edit abandoned INSIDE the autosave window still survives. Without this
    // the test proves nothing: waiting 500ms lets the 400ms autosave save the
    // document anyway, so leaving it could skip saving and nothing would notice.
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    store.dispatch(P.addElement(band0().id, mkText('unsaved-yet', 60)));
    doc.getElementById('openDocs').dispatchEvent(clickEv()); // no await: autosave has not fired
    const away = docRows().find((r) => r.querySelector('b').textContent !== 'سند الف');
    if (!away) fail('there is no second document to leave for');
    away.dispatchEvent(clickEv());
    await settle25();
    if (P.findElement(store.getState(), 'unsaved-yet'))
      fail('leaving a document did not actually leave it');
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    docRows()
      .find((r) => r.querySelector('b').textContent === 'سند الف')
      .dispatchEvent(clickEv());
    await settle25();
    if (!P.findElement(store.getState(), 'unsaved-yet'))
      fail('an edit made just before switching away was lost');

    // two documents may not share a name — a home screen exists to tell them apart
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    const uniqueNames = new Set(docNames());
    if (uniqueNames.size !== docNames().length)
      fail('two documents ended up with the same name: ' + docNames().join(' | '));
    // and two new documents in a row must not both be "سند بی‌نام"
    doc.getElementById('docsNew').dispatchEvent(clickEv());
    await settle25();
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    doc.getElementById('docsNew').dispatchEvent(clickEv());
    await settle25();
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    if (new Set(docNames()).size !== docNames().length)
      fail('two fresh documents share a name: ' + docNames().join(' | '));

    // search filters the library with the gallery's folding
    const docsSearch = doc.getElementById('docsSearch');
    docsSearch.value = 'الف';
    docsSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (!docNames().includes('سند الف')) fail('searching the library lost the matching document');
    if (docNames().length !== 1) fail('the library search matched too much: ' + docNames().length);
    docsSearch.value = 'قطعاً‌نیست';
    docsSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (docRows().length) fail('a nonsense query still matched documents');
    if (!doc.getElementById('docsEmpty').classList.contains('show'))
      fail('no empty state for a library search that matched nothing');
    docsSearch.value = '';
    docsSearch.dispatchEvent(new window.Event('input', { bubbles: true }));

    // duplicating gives a second, independently named copy
    const before25 = docRows().length;
    const openedBeforeDup = store.getState().metadata.name;
    const dupRow = docRows().find((r) => r.querySelector('b').textContent === 'سند الف');
    dupRow.querySelector('[data-act="dup"]').dispatchEvent(clickEv());
    await settle25();
    if (docRows().length !== before25 + 1) fail('duplicating did not add a document');
    if (new Set(docNames()).size !== docNames().length)
      fail('the duplicate reused the original’s name');
    if (store.getState().metadata.name !== openedBeforeDup)
      fail('duplicating switched the open document out from under the editor');

    // picking a template also starts its own document rather than overwriting
    const openBefore = store.getState().metadata.name;
    const libBefore = docRows().length;
    docsPanel.classList.remove('show');
    doc.getElementById('openGallery').dispatchEvent(clickEv());
    doc.querySelector('.tpl-card[data-template="receipt"]').dispatchEvent(clickEv());
    await settle25();
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    if (docRows().length !== libBefore + 1)
      fail('loading a template did not create a document of its own');
    if (!docNames().includes(openBefore))
      fail('loading a template overwrote the document that was open');
    docsPanel.classList.remove('show');

    // The panel reports the LIVE name of the document on screen, without saving
    // first. That is what lets opening the panel be read-only, which in turn is
    // what makes the "leaving a document saves it" test above mean anything.
    const liveNamed = JSON.parse(JSON.stringify(store.getState()));
    liveNamed.metadata = { name: 'نامِ تازه' };
    store.dispatch(P.replaceTemplate(liveNamed));
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    await settle25(); // let that much reach storage, so the next edit is unsaved
    store.dispatch(P.addElement(band0().id, mkText('live-count', 90)));
    const liveCount = store
      .getState()
      .bands.reduce((n, b) => n + ((b.elements && b.elements.length) || 0), 0);
    doc.getElementById('openDocs').dispatchEvent(clickEv()); // no await: nothing saved yet
    if (!docNames().includes('نامِ تازه'))
      fail('the library showed a stale name for the document on screen');
    const currentRow = docRows().find((r) => r.classList.contains('is-current'));
    const shownCount = Number(currentRow.querySelector('.doc-meta').textContent.split('·').pop());
    if (shownCount !== liveCount)
      fail('the library showed a stale element count: ' + shownCount + ' want ' + liveCount);

    // Deleting the document you are editing removes it from the library but
    // leaves it on screen: it is not gone until you leave it, and blanking the
    // canvas would be a second destruction nobody asked for.
    store.dispatch(P.addElement(band0().id, mkText('still-here', 80)));
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    window.confirm = () => true;
    const victim = docRows().find((r) => r.classList.contains('is-current'));
    if (!victim) fail('the open document is not marked, so it cannot be the delete target');
    const libSizeBeforeDelete = docRows().length;
    victim.querySelector('[data-act="del"]').dispatchEvent(clickEv());
    await settle25();
    if (docRows().length !== libSizeBeforeDelete - 1) fail('deleting did not remove the document');
    if (!P.findElement(store.getState(), 'still-here'))
      fail('deleting the open document also wiped the canvas');
    docsPanel.classList.remove('show');

    // --- share links vs. the document library (designer-ux ۴.۲) ---
    // Pasting a share link into an open designer fires `hashchange`. That used
    // to swap the template in place, which cost only the undo history — until
    // 2.5 gave the open document a library entry, at which point the next
    // autosave wrote the shared template straight over the user's own work.
    // Start from a document that is genuinely open. The delete test above left
    // none, and with no current document the guarded path is never reached —
    // the first version of this test passed for that reason rather than on merit.
    doc.getElementById('docsNew').dispatchEvent(clickEv());
    await settle25();
    const shareBand = JSON.parse(JSON.stringify(store.getState()));
    shareBand.metadata = { name: 'سندِ خودم' };
    store.dispatch(P.replaceTemplate(shareBand));
    doc.querySelector('#inspector [data-band="0"]').dispatchEvent(clickEv());
    store.dispatch(P.addElement(band0().id, mkText('mine-only', 30)));
    await settle25();

    // a template that is plainly not the open one
    const shared = JSON.parse(P.serializeTemplate(store.getState()));
    shared.metadata = { name: 'سندِ اشتراکی' };
    shared.bands[0].elements = [
      {
        id: 'shared-only',
        type: 'staticText',
        bounds: { x: 0, y: 0, width: 200, height: 16 },
        zIndex: 1,
        text: 'از لینک آمده',
        typography: { fontFamily: 'Vazirmatn', fontSize: 11 },
      },
    ];
    const payload = window.DesignerUtil.toBase64Url(JSON.stringify(shared));
    // `location.hash = …` fires hashchange by itself, so setting it *and*
    // dispatching ran the handler twice and created two documents. replaceState
    // changes the URL silently, leaving exactly one event — which is what
    // pasting a link into the address bar actually produces.
    window.history.replaceState(null, '', '#t=' + payload);
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await settle25();

    if (!P.findElement(store.getState(), 'shared-only')) fail('the shared template did not open');
    if (store.getState().metadata.name !== 'سندِ اشتراکی')
      fail('the shared document has the wrong name: ' + store.getState().metadata.name);

    // the user's document must still be there, with its element
    doc.getElementById('openDocs').dispatchEvent(clickEv());
    await settle25();
    const namesAfterShare = docNames();
    if (!namesAfterShare.includes('سندِ خودم'))
      fail('a share link destroyed the open document: ' + namesAfterShare.join(' | '));
    if (!namesAfterShare.includes('سندِ اشتراکی'))
      fail('the shared template did not become a document of its own');
    docRows()
      .find((r) => r.querySelector('b').textContent === 'سندِ خودم')
      .dispatchEvent(clickEv());
    await settle25();
    if (!P.findElement(store.getState(), 'mine-only'))
      fail('the user’s work was overwritten by the shared template');
    if (P.findElement(store.getState(), 'shared-only'))
      fail('the shared template leaked into the user’s document');

    // The link the share BUTTON produces must be one the app can read back.
    // Encoding the payload here instead would test the codec twice and the
    // button not at all — which is exactly what the first version did.
    window.history.replaceState(null, '', window.location.pathname);
    doc.getElementById('shareLink').dispatchEvent(clickEv());
    await settle25();
    const madeHash = window.location.hash;
    if (madeHash.indexOf('#t=') !== 0) fail('the share button produced no link: ' + madeHash);
    const roundTrip = P.importTemplate(window.DesignerUtil.fromBase64Url(madeHash.slice(3)));
    if (!roundTrip.success) fail('the link the share button produced does not import back');
    if (!P.findElement(roundTrip.value, 'mine-only'))
      fail('the shared link does not carry the open document’s content');
    if (roundTrip.value.metadata.name !== store.getState().metadata.name)
      fail('the shared link names a different document than the one open');
    window.history.replaceState(null, '', window.location.pathname);

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
