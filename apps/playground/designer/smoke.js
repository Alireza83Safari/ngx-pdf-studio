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
  if (cards.length < 11) fail('expected 11+ template cards, got ' + cards.length);
  const thumbs = doc.querySelectorAll('.tpl-thumb svg');
  if (thumbs.length < 11) fail('template thumbnails missing: ' + thumbs.length);
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

  console.log(
    'designer smoke OK — overlays:',
    overlays.length,
    '| chips:',
    chips.length,
    '| svg bytes:',
    svgHtml.length,
  );
  process.exit(0);
} catch (e) {
  console.error('CRASH:', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
  process.exit(1);
}
