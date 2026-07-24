/** Probe: what does pdfjs give us for a PDF rendered by our own engine? */
import { renderToPdf, loadBundledVazirmatn } from '/home/alireza/workspace/my-project/ngx-pdf-studio/packages/pdf-studio/core/src/node';
import type { PdfTemplate } from '/home/alireza/workspace/my-project/ngx-pdf-studio/packages/pdf-studio/core/src';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.js';

const template: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'probe' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 800 },
      elements: [
        {
          id: 'e1',
          type: 'staticText',
          bounds: { x: 50, y: 100, width: 200, height: 24 },
          zIndex: 1,
          text: 'فاکتور فروش',
          typography: { fontFamily: 'Vazirmatn', fontSize: 20, color: { space: 'rgb', r: 37, g: 99, b: 235 } },
        },
        {
          id: 'e2',
          type: 'staticText',
          bounds: { x: 60, y: 200, width: 150, height: 18 },
          zIndex: 1,
          text: 'Hello ABC',
          typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
        },
        {
          id: 'e3',
          type: 'line',
          bounds: { x: 40, y: 300, width: 250, height: 0 },
          zIndex: 1,
          stroke: { width: 2, color: { space: 'rgb', r: 200, g: 30, b: 30 } },
        },
        {
          id: 'e4',
          type: 'rectangle',
          bounds: { x: 40, y: 350, width: 120, height: 60 },
          zIndex: 1,
          box: {
            fill: { color: { space: 'rgb', r: 241, g: 245, b: 249 } },
            border: { all: { width: 1, color: { space: 'rgb', r: 203, g: 213, b: 225 } } },
          },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

async function main() {
  const font = loadBundledVazirmatn();
  const res = await renderToPdf(template, { data: {} }, { pdf: { fonts: font } });
  console.log('diagnostics:', res.diagnostics);

  const doc = await getDocument({ data: res.bytes, useSystemFonts: false, isEvalSupported: false, useWorkerFetch: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  console.log('viewport:', vp.width, vp.height);

  const tc = await page.getTextContent();
  for (const item of tc.items as any[]) {
    if (!('str' in item)) continue;
    console.log(JSON.stringify({
      str: item.str,
      dir: item.dir,
      transform: item.transform,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      hasEOL: item.hasEOL,
    }));
  }
  console.log('styles:', JSON.stringify(tc.styles));

  const opList = await page.getOperatorList();
  const opNames = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
  for (let i = 0; i < opList.fnArray.length; i++) {
    const name = opNames[opList.fnArray[i]];
    if (['beginText', 'endText', 'setFont', 'showText', 'setTextMatrix', 'dependency'].includes(name)) continue;
    let args = opList.argsArray[i];
    try {
      args = JSON.parse(JSON.stringify(args, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as any) : v)));
    } catch { /* keep raw */ }
    console.log(name, JSON.stringify(args)?.slice(0, 200));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
