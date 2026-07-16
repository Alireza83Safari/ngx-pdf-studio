# TODO / Roadmap — ngx-pdf-studio

وضعیت کلی: **موتور کامل (۲۸۹ تست سبز)، دیزاینر WYSIWYG با گالری قالب، pipeline انتشار آماده.**
این فایل کارهای باقی‌مونده رو نسبت به اسپک
(`pdf-studio-build-prompt.md`، فازهای §15) فهرست می‌کنه.

Legend: ✅ انجام‌شده · 🟡 ناقص/جزئی · ⬜ شروع‌نشده · 🚧 در حال انجام

---

## ✅ انجام‌شده

- **Phase 0 — Foundations:** ورک‌اسپیس، ۸ ADR، tooling (TS strict، Jest، ESLint، Prettier)، LICENSE.
- **Phase 1 — Model & engines:** schema + validator (zod) + migration + round-trip؛ موتور عبارت sandboxed؛ binding؛ موتور صفحه‌بندی؛ هر دو painter (SVG + PDF با pdf-lib/fontkit)؛ ورودی Node با خروجی دترمینیستیک.
- **Phase 2 (بخش اصلی):** DataField، **Table** (ستون fixed/percent/auto، header/detail/footer، aggregate، striping، RTL)، **List/Repeater**، تکرار header/footer، detail overflow، فرمت‌دهی.
- **Phase 3 — i18n:** bidi (UAX #9) + شکل‌دهی فارسی + فونت **Vazirmatn** باندل‌شده؛ ارقام لاتین/فارسی؛ تقویم **جلالی + میلادی**؛ تست golden §11 (استخراج متن با pdfjs).
- **Phase 4 (هسته):** `DocumentStore` فریم‌ورک‌اگنوستیک با command pattern (undo/redo، coalescing).
- **Angular:** `@ngx-pdf-studio/angular` (سرویس render + `<pdf-studio-preview>` + NgModule، Angular-12-safe، build APF با ng-packagr، تست TestBed).
- **Barcode:** Code 39 + رجیستری symbology.
- **Playground:** دموی فاکتور فارسی (PDF + پیش‌نمایش HTML).

---

## ✅ دیزاینر بصری (نسخهٔ ۲ — WYSIWYG)

`apps/playground/designer/` — دیزاینر مرورگری بدون dev-server (روی موتور bundle‌شده):
**بوم WYSIWYG واقعی** (پس‌زمینه = SVG خود موتور، همان درختی که PDF می‌شود؛ overlayهای
شفاف برای تعامل)، **جعبه‌ابزار ۹ الِمانی** (متن/فیلد/مستطیل/خط/بیضی/تصویر/بارکد/QR/چارت)،
**snap به grid + لبهٔ الِمان‌ها با خط راهنمای زنده** (Alt=خاموش)، **multi-select با Shift**،
**zoom** (دکمه + Ctrl+چرخ‌موس)، **nudge با فلش‌ها** (Shift=۱۰pt)، **Ctrl+D کپی**، inspector
وابسته به نوع (geometry/rotation/بایند/symbology/chartKind/fit/رنگ/فونت)، undo/redo،
پیش‌نمایش زنده، ورود/خروجی JSON، دانلود PDF (Vazirmatn). smoke-test خودکار jsdom دارد.
اجرا: `npm run designer:build` سپس باز کردن `designer.html`.

---

## ⬜ باقی‌مونده

### Phase 4 — Designer UI (§8)

- ✅ **Canvas WYSIWYG** (SVG موتور + margins) — ⬜ rulers، نمایش چندبندی
- ✅ **جابه‌جایی/resize با دستگیره + rotate از inspector** — ⬜ drag از toolbox، دستگیرهٔ چرخش روی بوم
- ✅ **Snap** به grid + لبهٔ المان‌ها با خط راهنمای زنده
- ✅ **Multi-select** — shift-click + **marquee** (کادر کشیدن روی بوم) + حذف/جابه‌جایی گروهی + **align** (۶ جهت) + **distribute** افقی/عمودی (undoable یک‌مرحله‌ای) — ⬜ group/ungroup
- ✅ **Z-order** (بیار جلو / بفرست عقب در inspector؛ بازتاب فوری در بوم WYSIWYG)
- ✅ **Inspector** وابسته به نوع المان (geometry, rotation, typography, color, binding, symbology, chartKind, fit)
- ✅ **Field picker / data explorer** + **drag-to-bind** — چیپ‌های مسیر داده از JSON نمونه (شامل `items[0].name` و `len(items)`)؛ رها کردن روی بوم = فیلد بایندشدهٔ جدید، روی المان = تغییر بایند همان
- 🟡 **ویرایش inline روی canvas** ✅ دابل‌کلیک روی متن (ویرایش text) و فیلد/بارکد/QR (ویرایش بایند)؛ Enter=ثبت، Esc=لغو — ⬜ سلول جدول
- 🟡 **Undo/redo** (دکمه + کیبورد) + ✅ **autosave** (localStorage با debounce) + ✅ **draft recovery** (بازیابی خودکار هنگام باز شدن؛ دکمهٔ «سند نو») — ⬜ history دیداری
- ✅ **Zoom** (دکمه‌ها، ۱:۱، Ctrl+wheel) — ⬜ pan/fit/minimap
- ✅ **Duplicate (Ctrl+D)** — ⬜ کلیپ‌بورد بین سندی
- ✅ **Save/load/import/export** + validate روی import
- 🟡 **Keyboard shortcuts** (فلش‌ها/Delete/Escape/Ctrl+Z/Y/D) — ⬜ a11y کامل (ARIA، focus ring)

### Phase 4A — Designer craft & ergonomics (§8A)

- 🟡 Design tokens (CSS vars) + **تم light/dark** ✅ (تاگل 🌙 با ذخیره در localStorage) — ⬜ white-label
- ⬜ UI دوزبانه fa/en با چرخش LTR↔RTL، مستقل از زبان سند
- ⬜ Floating contextual toolbar (سبک Canva/Figma) + context menu
- ✅ **Command palette (Ctrl+K)** — افزودن همهٔ المان‌ها، گالری، دانلود PDF، زوم، تم، سند نو؛ فیلتر + کیبورد
- ⬜ Color/font/image UX (swatch، eyedropper، font preview، paste/drop)
- ✅ **Preview-values toggle** — دکمهٔ 🔢: بوم بین مقدار نمونه و {نام بایند} سوییچ می‌کند
- 🟡 Smart snapping با خط راهنمای زندهٔ هم‌ترازی ✅ — ⬜ فیدبک عددی فاصله
- ⬜ Snippets / saved components، document theme presets
- ⬜ لمسی/ریسپانسیو (iPad)، onboarding tour
- ⬜ ۶۰fps، virtualization لیست‌ها

### Phase 4B — Starter templates & themes (§8A-B)

- ✅ **گالری قالب آماده** — دکمهٔ «🗂 قالب‌ها» در دیزاینر با **بندانگشتی WYSIWYG زنده** (رندر واقعی موتور)؛ ۵ قالب فارسی/RTL معتبر (صفر issue/diagnostic): **فاکتور فروش** (جدول + جمع + QR)، **گزارش فروش** (چارت + جدول)، **سربرگ نامه**، **برچسب محصول** (سایز سفارشی + Code128 + QR)، **گواهی‌نامه** (افقی با قاب) — هر کدام با دادهٔ نمونهٔ خودش؛ لود = تعویض قالب + دیتا + رفرش field picker — ⬜ packing list، تم‌های خروجی/style presets سراسری

### Phase 5 — عناصر پیشرفته و extensibility (§5, §12)

- ✅ **RichText / Paragraph** — چند ران با استایل مستقل، فیلد inline (expr)، word-wrap چندرانی، چند پاراگراف، auto-grow؛ هر دو painter. (⬜ justify واقعی، bidi کامل درون پاراگراف)
- ✅ **Image** واقعی — embed PNG/JPEG در PDF + `<image>` در SVG، fit (contain/cover/fill/none)، منبع/data-URI/URL. (⬜ SVG→vector، URL در PDF)
- 🟡 **Barcode**: Code 39 ✅ + **Code 128** ✅ (Code B/C، checksum mod-103) + **EAN-13** ✅ (لید-دیجیت با parity L/G، check mod-10، تأیید با decoder round-trip) — ⬜ UPC-A/E/ITF/DataMatrix/PDF417/Aztec/GS1
- ✅ **QRCode** — encoder معتبر (qrcode-generator)، رندر برداری در هر دو painter، **تأییدشده با decode واقعی jsQR** (نه فقط ساختاری). سطح EC قابل‌انتخاب، quiet zone استاندارد.
- 🟡 **Chart** برداری: column/bar/line/**stackedColumn**/**area**/**pie**/**donut** ✅ + **برچسب محور** (دسته‌ها زیر محور/کنار ردیف، مقدار max) + **legend** (سری‌ها؛ ستون دسته‌ها برای pie/donut) ✅ — هر دو painter از طریق `VectorOp` نوع `text` — ⬜ scatter/combo، sparkline
- 🟡 **Crosstab / Pivot** ✅ ماتریس سطر×ستون + measure تجمیعی + جمع‌های سطر/ستون/کل، RTL — ⬜ گروه‌های تو‌در‌تو، چند measure
- 🟡 **Subreport** ✅ جاسازی زیرگزارش ثبت‌شده با دیتاست خودش (block inline، report header + detail rows + footer، offset در bounds) — ⬜ شکست بین صفحات، master-detail تو‌در‌تو
- ✅ **Container/group** nesting در layout — جعبهٔ کانتینر + فرزندان به‌صورت بازگشتی با offset نسبی (تو‌در‌تو)
- ✅ **PageBreak** صریح (`pageBreakBefore`/`pageBreakAfter` + المان `pageBreak`)، **columns** چندستونی (پرشدن ستون‌به‌ستون سپس صفحهٔ بعد، colX راست‌چین‌پذیر)، **watermark/background** در همهٔ صفحات
- 🟡 رجیستری‌ها: barcode ✅ + function ✅ + **element registry** ✅ (`ElementRegistry` — المان `custom` با `renderer`/`value`/`options`؛ خروجی `VectorOp[]` خنثی که هر دو painter یکسان می‌کشن = WYSIWYG رایگان برای gauge/sparkline/مهر و…) — ⬜ dataProvider/font registry

### Phase 5A — عمق گزارش (§11A-D)

- ✅ **Grouping**: groupHeader/groupFooter چندسطحی در موتور صفحه‌بندی + **aggregate گروهی** (`sum($group, expr)`، `$groupKey`/`$groupIndex`)
- 🟡 **running totals** ✅ از طریق `sum(slice($root.items, 0, $index+1), expr)` (توابع `slice`/`len`/`abs`/`round` اضافه شد) — ⬜ متغیر با reset scope، carried-forward، «ادامه در صفحهٔ بعد»
- ✅ **bookmarks/outline** ساختار تو‌در‌تو از `element.bookmark` (تأیید `pdfjs.getOutline()`) + ✅ **hyperlinks** (`element.link` خارجی URL یا page-jump داخلی، Link annotation، تأیید `pdfjs.getAnnotations()`) + ✅ **ToC خودکار** (عنصر `toc`: یک خط per bookmark با شماره صفحه و تورفتگی سطح؛ صفحه‌بندی two-pass با bounds ثابت → شماره‌ها پایدار؛ ارقام فارسی per locale؛ `maxDepth`/`lineHeight`) — ⬜ cross-reference/drill-through داده‌محور
- ✅ **Conditional formatting** کامل: `conditionalStyles` + **data bars** (نوار متناسب، RTL-aware) + **color scales** (درون‌یابی sRGB روی fill) + **icon sets** (circle/square/triangleUp/triangleDown، انتخاب با آستانه، رنگ‌پذیر، هر دو painter — SVG برداری، PDF با drawSvgPath/ellipse/rect)
- 🟡 **Variables با reset scope** ✅ متغیرهای گزارش (`template.variables`) با `$vars.<name>`؛ calc=sum/count/avg/min/max/first/last؛ reset=report یا group (per-level)؛ running total در detail + subtotal در group footer — ⬜ reset=page (نیازمند آگاهی از مرز صفحه، فعلاً به report برمی‌گرده با warning)، carried-forward/«ادامه در صفحهٔ بعد»

### Phase 5B — ساختار سند و batch (§11A-E/F)

- ✅ **Sections با page-setup مستقل + mixed page sizes** (هر section اندازه/جهت/حاشیه؛ شماره‌گذاری پیوسته، `$pageCount` سراسری)
- ✅ **Master pages** — سرصفحه/پاصفحهٔ متفاوت برای `first`/`odd`/`even` (با اولویت specificity؛ رزرو ارتفاع = بلندترین variant)
- ✅ **restart شماره per section** — `section.restartPageNumbers`؛ numbering groupها، `$page`/`$pageCount` محلیِ گروه، اندیس فیزیکی صفحه absolute (برای link/bookmark)
- 🟡 **Batch/mail-merge**: `renderBatch`/`renderMerged` ✅ — ⬜ streaming برای اسناد خیلی بزرگ، document assembly پیشرفته
- 🟡 خروجی **SVG per page** ✅ (`renderToSvg` → یک رشتهٔ SVG برای هر صفحه) — ⬜ raster (PNG/JPEG با DPI، نیازمند canvas)، چاپ مستقیم مرورگر
- ⬜ بودجهٔ کارایی + رندر روی worker/off-main-thread

### Phase 5C — استانداردها و چاپ (سخت‌ترین، §11A-A/B/C)

- ⬜ **Tagged/Accessible PDF (PDF/UA)** + checker داخل ادیتور
- ⬜ **PDF/A** (A-1b/2b/3b) با اعتبارسنج
- ⬜ **PDF/X** (output intent/ICC)
- ⬜ **Encryption** (AES-256، permissions)
- ⬜ **امضای دیجیتال PAdES** (visible/invisible، timestamp)
- 🟡 **XMP metadata** ✅ بستهٔ XMP دترمینیستیک به‌عنوان `/Metadata` کاتالوگ (DC + xmp + pdf namespace، تاریخ ثابت، escape، uncompressed برای PDF/A) — ⬜ linearization، PDF version targeting
- 🟡 **AcroForm** ✅ فیلدهای پرشدنی text + checkbox (`formField`؛ ویجت واقعی pdf-lib، تأیید `pdfjs.getFieldObjects`، placeholder در SVG، گارد نام تکراری) — ⬜ radio/dropdown/list/signature field، فرمت/ولیدیشن
- 🟡 **CMYK** ✅ خروجی واقعی `DeviceCMYK` (`k`/`K`) در PDF painter (تأییدشده با inflate محتوای صفحه)؛ spot با تقریب RGB — ⬜ spot/Pantone جداگانه (Separation)، ICC، overprint
- ⬜ Bleed/trim/crop/registration marks + bleed guides
- ⬜ Image DPI/downsampling/JPEG quality
- ⬜ تایپوگرافی پیشرفته: OpenType features (tabular figures)، **hyphenation**، **font fallback chains**، شکست خط Knuth–Plass، baseline grid، footnotes، text-on-path

### Phase 6 — Polish & release (§14A)

- ✅ **CI** — ماتریس Node 18/20/22 (همهٔ گیت‌ها) + **ماتریس Angular 12/17/latest** (type-compat مصرف‌کننده روی tarball واقعی؛ سه باگ سازگاری واقعی پیدا و رفع کرد: peer جاافتادهٔ `@angular/platform-browser`، سینتکس TS4.5+ در d.ts (downlevel در build)، نشت تایپ zod به سطح عمومی (schemaها opaque منتشر می‌شن))
- 🟡 **Consumer tarball smoke test** ✅ `npm run smoke:tarball` — pack از dist، نصب در پروژهٔ tmp تمیز، رندر PDF فارسی از `@ngx-pdf-studio/core/node` (فونت داخل پکیج) — ⬜ مصرف‌کنندهٔ Angular 12/latest
- ✅ build واقعی `core` به dist — `npm run build:core` (tsc CJS + d.ts → `core/dist`، package.json بازنویسی‌شده برای publish، فونت Vazirmatn داخل پکیج با fallback مسیر dev/dist، smoke render فارسی از dist تأیید شد)
- ✅ سیم‌کشی topology دو-پکیجی (ADR-0005) — build انگولار (ng-packagr) حالا `@ngx-pdf-studio/core` را از **dist** (d.ts) می‌بیند نه سورس؛ APF کامل سبز
- ⬜ secondary entry points: `./designer` جدا از render سبک
- ✅ پایپ‌لاین انتشار — `release.yml`: تگ `v*` → همهٔ گیت‌ها + build + tarball smoke + `npm publish dist --provenance` (نیازمند secret NPM_TOKEN)؛ gate روی `npm audit` (scoped به پکیج منتشرشدنی، صفر آسیب‌پذیری) در CI و release — ⬜ Changesets/CHANGELOG خودکار
- ⬜ `ng update` migration schematics
- 🟡 مستندات: **README کامل** + `docs/getting-started` + `docs/expression-language` + `docs/rtl-persian` ✅؛ TSDoc روی API های اصلی — ⬜ سایت docs، Storybook
- 🟡 مرجع زبان عبارت ✅ + راهنمای RTL/Persian ✅ — ⬜ راهنمای نصب per-Angular-version

### Cross-cutting / گپ‌های فنی شناخته‌شده

- ⬜ **پاریتی واقعی byte بین مرورگر و Node** به‌عنوان job در CI (الان فقط determinism درون‌پروسس اثبات شده)
- ⬜ **Golden رستر** (pixelmatch + node-canvas/pdfjs render) — الان فقط استخراج متن
- ✅ **rotation** در هر دو painter — SVG با `rotate(deg cx cy)` و PDF با ماتریس q…cm…Q حول مرکز المان (زاویه‌های راست دقیق 0/±1)
- ✅ **showText** بارکد — متن خوانا زیر میله‌ها (میله‌ها کوتاه می‌شن، متن وسط‌چین؛ هر دو painter)
- ✅ **split جدول بین صفحات با تکرار header** — باند بلندتر از صفحه در مرز ردیف‌ها chunk می‌شه؛ سلول‌های header (`repeatOnSplit`) بالای هر ادامه تکرار می‌شن؛ ترتیب/کامل‌بودن ردیف‌ها حفظ
- ⬜ Worker برای layout/PDF سنگین؛ lazy-load chunk دیزاینر
- ⬜ شاخهٔ shaping با HarfBuzz اگر fontkit برای اسکریپتی کم آورد (ADR-0003)

---

## پیشنهاد ترتیب (بیشترین ارزش اول)

1. **دیزاینر بصری مینیمال** (Phase 4 هسته) — تا «خودت با ماوس طراحی کنی». موتور آماده‌ست؛ فقط UI.
2. **عناصر پرکاربرد:** Image واقعی، RichText، QR، Chart.
3. **Grouping + running totals** (Phase 5A) — برای گزارش‌های مالی واقعی.
4. **گالری قالب + تم‌ها** (Phase 4B).
5. **استانداردها** (Phase 5C) به‌ترتیب نیاز: tagged PDF → PDF/A → encryption → PAdES.
6. **release pipeline + CI matrix** (Phase 6).
