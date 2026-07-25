# Document Module TODO — `core/src/document/`

هدف: تکمیلِ لایهٔ **فریم‌ورک‌اگنوستیک command/store** (§8, ADR-0004) که پشتِ دیزاینر است، تا
طراحی داخلِ اپ کامل، رقابتی (بنچمارک Canva/Figma/Webflow طبقِ §8A) و بدون گیر باشد.

**دامنه:** `packages/pdf-studio/core/src/document/` (`command.ts`, `commands.ts`,
`document-store.ts`, `template-ops.ts`) + هرچیزی در `model/` که این لایه برای کامل‌شدن
لازم دارد. **خارج از دامنه:** ریسپانسیوِ *chrome* دیزاینر (پنل/rail/breakpoint) — آن از قبل
در `DESIGN-REVIEW-TODO.md` آیتم **۲.۱** پیگیری می‌شود؛ اینجا فقط به این نگاه می‌کنیم که
لایهٔ داده/کامند چیزی را بلاک نکند.

## چرا این فایل

خواندنِ کامل `core/src/document/` (۲۳ تستِ موجود، ۷ کامندِ صادرشده) در کنارِ مصرفِ واقعی‌اش در
`designer.js` نشان داد **بیشترِ کامندهای واقعاً استفاده‌شده در دیزاینر اصلاً در core تعریف
نشده‌اند** — مستقیم در `designer.js` (plain JS, بدونِ تست، بدونِ در دسترس‌بودن برای پکیجِ
Angular) بازتعریف شده‌اند: `renameCmd`، `restoreCmd`/`updateCmd` (patch با updater دلخواه)،
`moveManyCmd`، `boundsManyCmd`، `ensureStylesCmd`/`removeStyles`، `ensureDatasetCmd`/
`removeDataset`، `patchBandCmd`، `addBandCmd`، `removeBandByIdCmd`، `moveBandCmd`،
`replaceTemplateCmd` (خطوط ~۲۶۸–۳۶۰، ~۷۳۸–۸۰۸، ~۱۰۰۰–۱۰۶۸ در `designer.js`). یعنی «هر ویرایش
از طریق DocumentStore» (ادعای [[designer-app]]) درست است، اما «هر ویرایش از طریق **core**
command model» نه — نصفِ واژگان واقعی بیرون از core زندگی می‌کند و invert/undo آن هیچ‌جا
یونیت‌تست نشده.

دومین یافته: `template-ops.ts:19` صریحاً می‌گوید *"container nesting: future work"* —
یعنی با اینکه مدل (`ContainerElement` در `elements.ts`) کاملاً کانتینرِ تودرتو را پشتیبانی
می‌کند و لایوت هم آن را رندر می‌کند (بازگشتی)، **هیچ کامندی نمی‌تواند به فرزندِ یک کانتینر
برسد، ویرایشش کند یا جابه‌جایش کند** — `findElement`/`updateElement`/`removeElement` فقط
سطحِ اول `band.elements` را می‌گردند.

---

## 🔴 دستهٔ ۱ — بلاکرِ «طراحی کامل» (بدونِ اینها دیزاینر نمی‌تواند از قابلیت‌های مدل استفاده کند)

- [ ] **۱.۱ — پشتیبانیِ تودرتو (nested containers) در `template-ops.ts`**
  - `findElement`/`updateElement`/`removeElement`/`insertElement` باید بازگشتی به
    `ContainerElement.children` هم سرک بکشند، نه فقط `band.elements`.
  - `ElementLocation` باید یک `path` (زنجیرهٔ containerId ها) نگه دارد نه فقط `bandIndex`،
    وگرنه undo/redo برای عناصرِ داخلِ کانتینر اصلاً کار نمی‌کند.
  - پذیرش: یک عنصر داخلِ یک `container` تودرتو (۲ سطح) با `patchElement`/`setElementBounds`/
    `removeElementById` قابل‌ویرایش باشد و invert درست کار کند.
  - چرا مهم: بدونِ این، **گروه‌بندی (۱.۳)** بی‌فایده است — عناصرِ داخلِ گروه غیرقابل‌ویرایش
    می‌مانند مگر با گشتنِ اختصاصی که در بالای core تکرار شود.

- [ ] **۱.۲ — کوچ‌دادنِ کامندهای واقعیِ دیزاینر به core**
  دقیقاً همین‌ها را (با همین سمانتیک) از `designer.js` به `commands.ts` منتقل کن — با تست:
  - `renameTemplate(name)` — پچِ `metadata.name`، معادلِ `renameCmd`.
  - `patchBand(bandIndex یا bandId, patch)`، `addBand(band, index?)`،
    `removeBandById(bandId)`، `moveBand(from, to)` — معادلِ چهارتاییِ باندِ خطِ ۱۰۰۰–۱۰۶۸.
  - `moveElementsBy(ids, dx, dy)` و `setElementsBounds(next, prev)` — نسخهٔ چندعنصریِ
    `setElementBounds` (الان `patchElement`/`setElementBounds` فقط تک‌عنصری‌اند؛ دیزاینر برای
    درگِ چندانتخابی و align/distribute خودش این‌ها را دوباره نوشته).
  - `ensureStyles(styles)` / `ensureDataset(name, source?)` — الحاقِ idempotent با invert
    دقیق (فقط چیزی که واقعاً اضافه شد را پاک کند).
  - `replaceTemplate(next, prev)` — برای لود کردنِ کاملِ سند (گالری/نسخهٔ تاریخچه/کوپایلوت)
    به‌صورتِ یک قدمِ undo واحد، به‌جای بازسازیِ استورِ جدید (که الان تاریخچه را می‌پرد).
  - پذیرش: `designer.js` این توابع را دیگر بازتعریف نکند، فقط از `P.<name>` صدا بزند؛
    `commands.spec.ts` هرکدام را با round-trip تست کند (الگوی تست‌های موجود، خط ۴۹–۱۰۵).

- [ ] **۱.۳ — کامندِ Group/Ungroup**
  از TODO.md ریشه («⬜ group/ungroup» در بخشِ Multi-select) — الان اصلاً هیچ‌جا (نه core نه
  designer.js) پیاده نشده.
  - `groupElements(ids, containerId)`: باندینگ‌باکسِ انتخاب را حساب کن، یک `ContainerElement`
    جدید با آن bounds بساز، عناصر را به `children` (با bounds نسبی) منتقل کن، در همان
    موقعیتِ z قبلی درجش کن. `invert` باید دقیقاً برگرداند (وابسته به ۱.۱).
  - `ungroupContainer(containerId)`: عکسِ بالا — فرزندان را با bounds مطلق به همان band/
    کانتینرِ والد برگردان و کانتینر را حذف کن.
  - پذیرش: گروه‌کردن ۳ عنصر → یک undo → دقیقاً برمی‌گردند به bounds/ترتیبِ اصلی‌شان.

---

## 🟡 دستهٔ ۲ — پاریتیِ رقابتی (چیزی که Figma/Canva دارند و اینجا مدل/کامندش نیست)

- [ ] **۲.۱ — قفلِ عنصر (`locked`)**
  نه در `ElementBase` (`element-base.ts`) و نه در `designer.js` هیچ فیلدِ lock وجود ندارد.
  - `ElementBase.locked?: boolean` در مدل + کامندِ `setElementLocked(id, locked)` در core.
  - در دیزاینر: عنصرِ قفل‌شده نه قابلِ درگ/ریسایز نه قابل‌حذف با کیبورد (هنوز قابل انتخاب/دیدن).
  - پذیرش: پنل لایه‌ها آیکونِ قفل دارد؛ toggle یک قدمِ undo است.

- [ ] **۲.۲ — نامِ نمایشیِ عنصر برای پنل لایه‌ها**
  الان لایه‌ها فقط با `type`/`id`/متنِ خامِ عنصر نمایش داده می‌شوند (چون هیچ فیلدِ نام‌گذاری‌شده‌ای
  در مدل نیست). یک `ElementBase.name?: string` اختیاری + کامندِ `renameElement(id, name)`
  (تفاوتش با `renameTemplate` در ۱.۲: این برای تک‌عنصر است، آن برای کل سند).
  - پذیرش: کاربر می‌تواند در پنل لایه‌ها دوبار-کلیک کند و نامِ دلخواه بدهد (مثلِ Figma).

- [ ] **۲.۳ — کامندهای z-order نسبی (bring-to-front / send-to-back / forward / backward)**
  الان فقط `setElementZIndex(id, zIndex)` هست (پچِ مقدارِ مطلق) — UI باید خودش
  max/min را روی خواهر-برادرها حساب کند. یک هِلپرِ core که نسبت به همبندی‌های همان
  band/container حساب کند و انتقالِ عدد را انجام دهد، منطقِ تکراری را از دیزاینر برمی‌دارد و
  برایِ کانتینرهای تودرتو (بعد از ۱.۱) درست کار می‌کند چون z-order هرجا محلی به همان والد است.

- [ ] **۲.۴ — سیستمِ استایل/تمِ قابلِ‌استفادهٔ مجدد در core**
  `ensureStylesCmd` فعلی (بعد از کوچ در ۱.۲) فقط «اضافه‌کن اگر نیست» است. برای پاریتی با
  Canva/Figma style-library لازم است:
  - `updateStyle(styleId, patch)` / `removeStyle(styleId)` / `duplicateStyle(styleId, newId)`
    با invert.
  - **Saved components/snippets** (از TODO.md ریشه: «⬜ Snippets / saved components،
    document theme presets») — یک ساختارِ داده برای «این زیرشاخه از عناصر را به‌عنوانِ کامپوننتِ
    قابلِ‌استفادهٔ مجدد ذخیره کن» + کامندِ `insertSnippet(bandId, snippet, at?)`. می‌تواند روی
    `groupElements` (۱.۳) سوار شود: هر گروه = کاندیدِ snippet.

- [ ] **۲.۵ — پشتیبانیِ `TemplateSection` (چندصفحه با اندازهٔ متفاوت) در کامندها**
  `model/template.ts` یک فیلدِ `sections?: TemplateSection[]` دارد (§11A-E، هر سکشن
  `page`/`bands` مستقل خودش را دارد) اما **همهٔ کامندهای فعلی و هم منطقِ باندِ `designer.js`
  فقط `template.bands`/`template.page` را می‌بینند** — یعنی سندِ چندسکشنی از طریقِ دیزاینر
  اصلاً قابل‌ویرایش نیست. یا صریحاً از دامنهٔ دیزاینر فعلی حذفش کن (کامنت در مدل)، یا کامندها
  را با یک `sectionIndex?` پارامتری کن. تصمیم را قبل از اجرا با پروداکت رول تیک بزن — کارِ
  بزرگی است، شاید فازِ جدا.

---

## 🟢 دستهٔ ۳ — آماده‌سازیِ آینده (نه بلاکر، ولی رویِ روادمپ سوار است)

- [ ] **۳.۱ — متادیتای کامند برای Collaboration (Phase 5.2، Yjs روی command stream)**
  `Command` (`command.ts`) الان فقط `type`/`apply`/`invert`/`coalesceKey` دارد — هیچ `id`،
  `actor`، یا `timestamp` ندارد. برای همکاریِ چندنفره روی command stream (roadmap 5.2) لازم
  است کامندها قابلِ سریالایز/ارسال باشند و روی state ریموت هم apply شوند بدونِ آلوده‌کردنِ
  استکِ undo محلی. پیشنهاد: یک `dispatchRemote(command)` روی `DocumentStore` که state را
  آپدیت می‌کند ولی undo/redo محلی را دست نمی‌زند؛ فقط طراحیِ اینترفیس، نه پیاده‌سازیِ کاملِ Yjs.

- [ ] **۳.۲ — تاریخچهٔ undo/redو با نمایشِ دیداری**
  از TODO.md ریشه: «🟡 Undo/redo … ⬜ history دیداری». `DocumentStore` الان فقط دو استکِ
  فلت (`undoStack`/`redoStack`) دارد، بدونِ لیبل/timestamp قابلِ‌نمایش. یک
  `getHistory(): { label: string; timestamp: number }[]` (بر پایهِ `command.type` + زمانِ
  dispatch) که UI بتواند لیستِ «۵ قدمِ قبل» را نشان دهد و کلیک=jump.

- [ ] **۳.۳ — تست‌های گمشده برای معادلِ ۱.۲/۱.۳ در `document-store.spec.ts`**
  بعد از کوچ، این سناریوها باید تست شوند (فعلاً هیچ‌کدام پوشش ندارند):
  گروه‌بندی/آن‌گروپ به‌عنوانِ یک قدمِ undo، ویرایشِ عنصرِ داخلِ کانتینرِ تودرتو، جابه‌جاییِ باند
  (`moveBand`) با undo، `ensureStyles`/`ensureDataset` وقتی استایل/دیتاست از قبل هست (باید
  NO_OP باشد و چیزی به تاریخچه اضافه نکند — الان در `designer.js` این رفتار تست‌نشده فرض شده).

---

## ترتیبِ پیشنهادیِ اجرا

1. **۱.۱** (تودرتو در template-ops) — همه‌چیزِ دیگر رویش سوار است.
2. **۱.۲** (کوچِ کامندهای واقعی) — همزمان با ۱.۱، چون بعضی کامندهای کوچ‌شده به مسیرِ تودرتو نیاز دارند.
3. **۱.۳** (Group/Ungroup) — روی ۱.۱ سوار است.
4. **۲.۱ → ۲.۲ → ۲.۳** (قفل، نام، z-order) — مستقل و کوچک، هرکدام یک PR.
5. **۲.۴** (استایل/snippet) — بعد از ۱.۳ چون روی گروه سوار می‌شود.
6. **۲.۵** (sections) — جدا، نیازِ تصمیمِ محصولی.
7. **۳.۱ → ۳.۲ → ۳.۳** — هر وقت جا باز شد؛ ۳.۳ باید همزمانِ هرکدام از بالا اضافه شود نه در آخر.

هر آیتم: پیاده‌سازی → تست در `commands.spec.ts`/`document-store.spec.ts` → گیت‌های
[[dev-workflow-gates]] → کامیت. اگر کامندی از `designer.js` کوچ می‌کنی، در همان کامیت
بازتعریفِ محلی‌اش را حذف کن (بدونِ shim/دوباره‌کاری).
