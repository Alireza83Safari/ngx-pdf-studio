# Moonshot Features — TODO (F1 + F2)

دو فیچرِ پرچم‌دار که محصول را از رقبا متمایز می‌کنند و **دقیقاً روی نقاط قوتِ موتور** سوارند:

- **F1 — Verifiable Documents** (سندِ ضدِّجعل) — چون رندر **دترمینیستیک** است.
- **F2 — Format Cloner** («هر سندی را بدزد») — چون ماژولِ **pdf-import** ۷۰٪ راه رفته.

> Legend: ⬜ شروع‌نشده · 🚧 در حال انجام · ✅ انجام‌شده
> ریتمِ کار: هر قدم → تست (`npm run test:core`) → گیت‌های `dev-workflow-gates` → تیک.
> نقشهٔ ماژول‌ها: `core-module-map` (memory). رندر: `createRenderContext → paginate → paint`.

**ترتیبِ اجرا:** اول **F1** (کوچک، خودکفا، بردِ سریع و کشنده برای بازارِ اسنادِ رسمی) → بعد **F2** (بزرگ‌تر، ویروسی).

---

## 🥇 F1 — Verifiable Documents (سندِ ضدِّجعل)

**پیچ:** از دادهٔ رندرشده یک هشِ محتوایی می‌سازی و به‌صورت QR + کدِ کوتاه روی PDF مهر می‌زنی؛ هرکس اسکن کند ثابت می‌شود «این سند از این داده ساخته شده و یک بایت هم عوض نشده».
**مو:** هیچ ابزارِ طراحیِ PDF این را ندارد چون رندرشان دترمینیستیک نیست. برای فاکتور/قرارداد/گواهیِ رسمیِ ایران کشنده است.
**چرا تو:** determinism + serialization کانونیک + QR (ماژولِ barcode) را **همین‌الان** داری.

### MVP
- [x] **۱.۱ — ماژولِ هش کانونیک** `core/src/verify/` ✅
  - `canonicalize(template, resolvedData, engineVersion) → string` (کلیدهای مرتب، نرمال‌سازیِ عدد/تاریخ). اگر `serialization/` کانونیکال‌سازی دارد، همان را بازاستفاده کن.
  - `hashDocument(...) → sha256 hex`. **مهم:** پیاده‌سازیِ هشِ **یکسان روی Node و مرورگر** (sha256 خالصِ JS یا لایهٔ نازک روی `crypto.subtle` با fallback) — چون تعیّن، کلِ داستان است.
  - تست: ورودی یکسان → هشِ یکسان روی هر دو پلتفرم؛ تغییرِ یک فیلد → هشِ متفاوت.
  - **انجام‌شده:** `core/src/verify/` با `sha256Hex` (SHA-256 + UTF-8 دست‌نویس → تعیّنِ مطلقِ Node=Browser، بدونِ وابستگی)، `canonicalize` (JSONِ کلید-مرتبِ بازگشتی)، `hashDocument(template,{data,parameters,now}) → {hash, short}`، و `verifyDocument(...)`. صادرشده از `core/index.ts`. **۹ تست سبز** (بردارهای NIST، UTF-8 فارسی، استقلال از ترتیبِ کلید، تشخیصِ دستکاری) + typecheck + lint تمیز.
- [x] **۱.۲ — بارِ تأیید + رندرِ مهر** ✅
  - payload: `{ v, hash, docId?, issuedAt? }`. یک helper که سرِ رندر، هش را از **همان دادهٔ رندرشده** محاسبه و یک المانِ QR (بایندشده به payload) + کدِ خوانا (۸ کاراکترِ اولِ هش) تزریق کند.
  - در هر دو painter (SVG + PDF) درست بنشیند.
  - **انجام‌شده:** `stampVerification(template, options) → PdfTemplate` در `verify/stamp.ts`. هش را از templateِ **اصلی** حساب می‌کند (بدونِ چرخه)، بعد یک باندِ `pageFooter` با المانِ **QR** (حاملِ hash یا `verifyUrl?h=…` به‌صورتِ literalِ escape‌شدهٔ DSL) + متنِ **کدِ کوتاه** (با `locale:{digits:'latn'}` تا hex همیشه لاتین) اضافه می‌کند. sections را هم پوشش می‌دهد؛ templateِ اصلی را mutate نمی‌کند. **۵ تستِ جدید** (ساختِ باند، عدم‌جهش، هشِ اصل، URL، **رندرِ واقعیِ SVG با کد در خروجی**). typecheck + lint تمیز.
- [x] **۱.۳ — گزینهٔ رندر** ✅
  - `renderToPdf(..., { verify: { enabled, position, docId? } })` در `render.ts`؛ هش از همان resolved data تا **دقیق** باشد.
  - **انجام‌شده:** `RenderOptions.verify?: boolean | VerifyRenderOptions` اضافه شد؛ در `layoutDocument` (نقطهٔ مشترکِ PDF+SVG) قبل از paginate، `withVerification` مهر را می‌زند و `data/parameters/now` را از همان render input می‌گیرد تا هش دقیق باشد. **۲ تستِ جدید** (فقط با verify کد ظاهر می‌شود؛ verifyUrl). **کلِ ۳۷۹ تستِ core سبز** (بدونِ رگرسیون).
- [x] **۱.۴ — تابع و صفحهٔ Verify** ✅
  - `verifyDocument(template, data) → { hash, matches(expected) }`.
  - یک `verify.html` سبک (کنارِ designer): کد/QR + JSON را بده → بازمحاسبه → ✓/✗.
  - **انجام‌شده:** `verifyDocument` از قبل بود. `apps/playground/designer/verify.html` ساخته شد — RTL، دارک‌مود، هم‌سبکِ دیزاینر؛ قالب + داده + کد را می‌گیرد و با `PdfStudio.verifyDocument` بازمحاسبه → **✓ معتبر / ✕ ناهمخوان / خطا / خنثی**. کدِ کوتاه یا هشِ کامل (uppercase/space) هر دو پذیرفته می‌شوند. **۸ چکِ jsdom با اجرای واقعیِ فلو سبز** (معتبر، دستکاری، JSONِ نامعتبر، خالی). (نیازِ `npm run designer:build` چون `engine.global.js` گیت‌ایگنور است.)
- [x] **۱.۵ — اتصال به دیزاینر** ✅
  - سوییچِ «مهرِ تأیید (QR)» در تنظیماتِ صفحه؛ هنگام Download PDF مهر بخورد و کد در UI دیده شود.
  - **انجام‌شده:** بخشِ «مهرِ تأیید» زیرِ تنظیماتِ صفحه با چک‌باکسِ `#verifyStamp` (ماندگار در localStorage) + نمایشِ **زندهٔ کدِ سند** که با هر ویرایش بازمحاسبه می‌شود. هنگام Download، اگر روشن باشد با `{ verify: true }` رندر می‌شود و کد در toast می‌آید. **مهم برای بازتولیدپذیری:** مسیرِ verified عمداً `now`ِ ناپایدار را حذف می‌کند تا کدِ چاپ‌شده دقیقاً با بازمحاسبهٔ `verify.html` (که فقط از قالب+داده حساب می‌کند) بخواند — پس کدِ پنل = کدِ روی کاغذ = کدِ verify. **smoke توسعه یافت** (پلی‌فیلِ TextEncoder، تستِ toggle+کدِ زنده+دانلودِ verified: کدِ پنل == کدِ toast)؛ **سبز**.
- [ ] **۱.۶ — تست‌های تعیّن + دستکاری + golden** ⬜

**پذیرش:** template+data یکسان همیشه یک هش می‌دهد (Node=Browser)؛ تغییرِ هر مقدارِ بایندشده QR را عوض می‌کند؛ صفحهٔ verify سندِ سالم را تأیید و دستکاری‌شده را رد می‌کند.

**Stretch:** امضای نامتقارن (کلیدِ صادرکننده) → «صادرشده توسط X»؛ timestamp؛ جاسازیِ هش در متادیتای XMPِ PDF؛ anchor روی زنجیره (اختیاری).

---

## 🥈 F2 — Format Cloner («هر سندی را در ۱۰ ثانیه بدزد»)

**پیچ:** PDF (یا **عکسِ موبایلی**) یک فرمتِ موجود را می‌اندازی؛ سیستم تشخیص می‌دهد چه ثابت است و چه فیلدِ داده، **schema را استنتاج** می‌کند، و یک قالبِ کاملاً بایندشدهٔ قابل‌ویرایش + دادهٔ نمونه تحویل می‌دهد.
**مو:** design-to-template **معکوس** — کسی فرمتِ یک بانک/سازمان را دارد، چند ثانیه بعد نسخهٔ برنامه‌پذیرش را دارد.
**چرا تو:** `pdf-import` (extract متن با transform/dir/font + rect + convert) و `copilot` (`CopilotProvider` + validate→repair) را داری.

### MVP
- [ ] **۲.۱ — هیوریستیکِ static-vs-dynamic (بدونِ AI، اول این)** ⬜
  - در مسیرِ `pdfContentToTemplate`: تشخیصِ ردیف‌های **تکرارشونده** (جدول)، جفتِ **label:value** (برچسبِ ثابت + مقدارِ متغیرنما)، و تاریخ/عدد/ارز با regex → پیشنهادِ binding.
  - ارزان، آفلاین، هم‌راستا با اتوسِ «provider رایگان/لوکال».
- [ ] **۲.۲ — طبقه‌بندِ AI (escalation برای مبهم‌ها)** ⬜
  - `PdfImportOptions.classifier?: CopilotProvider`. ساختارِ استخراج‌شده (متن + مختصات + الگوی تکرار) را با یک contractِ سخت بفرست → per-segment `{ role: 'static'|'field'|'tableColumn'|…, fieldPath, format }`.
  - از `extractJson` + الگوی validate→repairِ `generate.ts` بازاستفاده کن.
- [ ] **۲.۳ — استنتاجِ schema + دادهٔ نمونه** ⬜
  - از فیلدهای طبقه‌بندی‌شده یک `sampleData` JSON بساز (schema + مقدارِ مثال) و در `PdfImportResult.inferredData` برگردان تا قالب بلافاصله بایند و پیش‌نمایش‌پذیر باشد.
- [ ] **۲.۴ — auto-binding به المان‌ها** ⬜
  - segmentها → `dataField`/`labeledField`/`table` بایندشده به pathهای استنتاج‌شده (از ساختِ المانِ موجود در `convert.ts` استفاده کن).
- [ ] **۲.۵ — UX دیزاینر: «کلونِ فرمت»** ⬜
  - انداختنِ PDF → import+classify → لودِ قالب + `inferredData` → یک مرحلهٔ **مرورِ bindingها** (چیپ: چه متنی فیلد شد). از الگوی مُدالِ گالری/کوپایلوت استفاده کن.
- [ ] **۲.۶ — تستِ round-trip روی fixtureِ فاکتورِ واقعی** ⬜
  - assert: N فیلد، جدولِ اقلام، شکلِ `sampleData`؛ import→render شبیهِ اصل.

**پذیرش:** یک PDFِ فاکتورِ واقعی بده → قالبی برگردد که اقلامش **جدولِ بایندشده** و مقادیرِ سربرگش **فیلدِ بایندشده** باشند، به‌علاوهٔ `sampleData`ی که پیش‌نمایشِ وفادار بدهد — و مسیرِ **هیوریستیک بدونِ کلیدِ AI** هم کار کند.

**Stretch:** **عکس→قالب** (provider ویژن یا OCR → همان pipeline)؛ تشخیصِ لوگو→المانِ تصویر؛ «چند صفحه/چند فرمت در یک فایل».

---

## پیشرفت
- F1 Verifiable: ۵/۶ (۱.۱–۱.۵ ✅)
- F2 Format Cloner: ۰/۶
- **کل: ۵/۱۲**

> شروع از **۱.۱** (ماژولِ هشِ کانونیک) — خودکفا و پایهٔ بقیهٔ F1.
