/**
 * The designer's user-facing copy: the help centre's sections and the guided
 * tour's steps (designer-ux 4.2).
 *
 * Pure data — no DOM, no state, no behaviour — so it lives outside the 6,000-line
 * `designer.js` where it can be read, reviewed and checked against the app it
 * describes. It had already drifted: the help still promised nine tools and
 * twelve gallery templates long after there were twelve and twenty-two, because
 * buried in the middle of the application nobody saw it. `content.spec.js` now
 * fails the build when those numbers disagree with reality.
 *
 * Loaded as a plain script before `designer.js` (as `window.DesignerContent`)
 * and required directly by the tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignerContent = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var HELP_SECTIONS = [
    {
      id: 'start',
      title: 'شروع سریع',
      icon: 'chart',
      html:
        '<h3>خوش آمدی 👋</h3>' +
        '<p class="lead">اینجا سند PDF طراحی می‌کنی — همان چیزی که روی بوم می‌بینی، دقیقاً همان PDF نهایی است.</p>' +
        '<h4>چهار مفهوم، نیم دقیقه</h4>' +
        '<table class="htable"><tr><th>مفهوم</th><th>یعنی چه؟</th></tr>' +
        '<tr><td><b>قالب</b></td><td>طرح سند تو؛ یک فایل JSON قابل ذخیره و انتقال.</td></tr>' +
        '<tr><td><b>الِمان</b></td><td>هرچیزی روی صفحه: متن، فیلد داده، شکل، بارکد، چارت…</td></tr>' +
        '<tr><td><b>دادهٔ نمونه</b></td><td>JSON آزمایشی که موقع طراحی جای دادهٔ واقعی می‌نشیند.</td></tr>' +
        '<tr><td><b>بایند</b></td><td>وصل‌کردن الِمان به داده: «این متن، اسم مشتری را نشان بده».</td></tr></table>' +
        '<h4>سریع‌ترین مسیر</h4>' +
        '<ol><li>دکمهٔ <b>قالب‌ها</b> → یک طرح آماده (یا «سند خالی») را لود کن.</li>' +
        '<li>الِمان‌ها را جابه‌جا کن، دابل‌کلیک کن و متن‌ها را عوض کن.</li>' +
        '<li><b>دانلود PDF</b> را بزن. تمام!</li></ol>' +
        '<div class="callout"><span class="c-ico">💡</span><span>روی هر دکمه‌ای ماوس را نگه داری، تولتیپ توضیح می‌دهد. برای دیدن همهٔ فرمان‌ها هم <kbd>Ctrl</kbd>+<kbd>K</kbd> را بزن.</span></div>',
    },
    {
      id: 'env',
      title: 'محیط برنامه',
      icon: 'rectangle',
      html:
        '<h3>یک دور دور محیط</h3>' +
        '<p class="lead">پنج ناحیهٔ اصلی — دکمهٔ «تور معرفی» بالای همین پنجره، تک‌تکشان را روی خود محیط نشانت می‌دهد.</p>' +
        '<table class="htable"><tr><th>ناحیه</th><th>چه‌کار می‌کند</th></tr>' +
        '<tr><td><b>نوار بالا</b></td><td>نام سند (کلیک کن و عوضش کن)، واگرد/ازنو، پیش‌نمایش، قالب‌ها، منوی فایل و دکمهٔ اصلی «دانلود PDF».</td></tr>' +
        '<tr><td><b>ریل ابزار</b></td><td>۱۲ ابزار. کلیک = افزودن به بوم؛ <b>کشیدن</b> = افزودن دقیقاً همان‌جا که رها کنی.</td></tr>' +
        '<tr><td><b>بوم</b></td><td>کاغذ توست؛ رندر زندهٔ خود موتور PDF.</td></tr>' +
        '<tr><td><b>پنل راست</b></td><td>سه تب: <b>طراحی</b> (خواص انتخاب + صفحه)، <b>لایه‌ها</b> (فهرست الِمان‌ها)، <b>داده</b> (JSON نمونه + چیپ‌های بایند).</td></tr>' +
        '<tr><td><b>نوار وضعیت</b></td><td>زوم، «جا بده»، اندازهٔ کاغذ، وضعیت انتخاب و نشانگر ذخیرهٔ خودکار.</td></tr></table>',
    },
    {
      id: 'first',
      title: 'اولین طراحی',
      icon: 'staticText',
      html:
        '<h3>اولین طراحی — ۱۰ قدم</h3>' +
        '<p class="lead">یک کارت تبریک با اسمِ از-داده و QR؛ همین ده قدم، ۹۰٪ کار با دیزاینر است.</p>' +
        '<ol>' +
        '<li><b>قالب‌ها</b> → «سند خالی».</li>' +
        '<li>تب طراحی → بخش صفحه → اندازه: <b>سفارشی…</b> → ابعاد <code>400×250</code> → جهت کاغذ: افقی.</li>' +
        '<li>ابزار <b>متن</b> را از ریل بکش وسط کارت.</li>' +
        '<li>دابل‌کلیک → بنویس «تبریک می‌گوییم!» → <kbd>Enter</kbd>.</li>' +
        '<li>بخش ظاهر: فونت ۲۲، ضخیم، رنگ دلخواه.</li>' +
        '<li>تب <b>داده</b> → چیپ <code>customer.name</code> را بکش زیر تیتر — فیلد بایندشده ساخته می‌شود.</li>' +
        '<li>ابزار <b>QR</b> را بکش گوشهٔ پایین؛ در «محتوا» بنویس <code>' +
        "'https://example.ir'" +
        '</code>.</li>' +
        '<li>یک <b>خط</b> تزئینی بکش؛ با فلش‌های کیبورد دقیقش کن.</li>' +
        '<li><b>دانلود PDF</b> — کارت واقعی با فونت فارسی!</li>' +
        '<li>فایل → <b>ذخیرهٔ طرح (JSON)</b>.</li></ol>',
    },
    {
      id: 'data',
      title: 'داده و بایند',
      icon: 'dataField',
      html:
        '<h3>داده و بایند — قلب ماجرا</h3>' +
        '<p class="lead">فیلدها را یک‌بار به داده وصل می‌کنی؛ بعداً همین قالب با هر داده‌ای PDF می‌سازد.</p>' +
        '<h4>سه راه بایند</h4>' +
        '<ol><li><b>کشیدن چیپ روی بوم</b> → فیلد جدید بایندشده (ساده‌ترین راه).</li>' +
        '<li><b>کشیدن چیپ روی یک الِمان</b> → بایند همان الِمان عوض می‌شود.</li>' +
        '<li><b>دستی</b>: الِمان را انتخاب کن → محتوا → بایند.</li></ol>' +
        '<h4>زبان عبارت</h4>' +
        '<table class="htable"><tr><th>می‌خواهی…</th><th>بنویس</th></tr>' +
        '<tr><td>مقدار ساده</td><td><code>customer.name</code></td></tr>' +
        '<tr><td>عضو آرایه</td><td><code>items[0].name</code></td></tr>' +
        '<tr><td>محاسبه</td><td><code>qty * price</code></td></tr>' +
        '<tr><td>جمع ستون</td><td><code>sum(items, qty * price)</code></td></tr>' +
        "<tr><td>متن ترکیبی</td><td><code>'جناب ' + customer.name</code></td></tr>" +
        "<tr><td>شرطی</td><td><code>total > 1000 ? 'ویژه' : 'عادی'</code></td></tr></table>" +
        '<div class="callout"><span class="c-ico">🔢</span><span>دکمهٔ «مقادیر» در نوار بالا، بوم را بین مقدار نمونه و {نام فیلد} سوییچ می‌کند تا ببینی چه‌چیزی به کجا وصل است.</span></div>',
    },
    {
      id: 'tools',
      title: 'ابزارها',
      icon: 'chart',
      html:
        '<h3>ابزارها — نکتهٔ هر کدام</h3>' +
        '<table class="htable"><tr><th>ابزار</th><th>نکته</th></tr>' +
        '<tr><td><b>متن</b></td><td>برای نوشته‌های ثابت. دابل‌کلیک = ویرایش سریع.</td></tr>' +
        '<tr><td><b>فیلد داده</b></td><td>خروجی از داده می‌آید. دابل‌کلیک = ویرایش بایند.</td></tr>' +
        '<tr><td><b>مستطیل/بیضی/خط</b></td><td>قاب، پس‌زمینه و جداکننده؛ رنگ در بخش «ظاهر».</td></tr>' +
        '<tr><td><b>تصویر</b></td><td>«آدرس» = URL یا data-URI داخل کوتیشن؛ «برازش» = contain/cover/fill.</td></tr>' +
        '<tr><td><b>بارکد</b></td><td>Code128 (متن/عدد)، Code39، EAN-13 (دقیقاً ۱۲ یا ۱۳ رقم معتبر). متن خوانا زیر میله‌ها روشن است.</td></tr>' +
        '<tr><td><b>QR</b></td><td>هر متنی، معمولاً URL — واقعاً اسکن می‌شود؛ با گوشی امتحان کن!</td></tr>' +
        '<tr><td><b>چارت</b></td><td>«دیتاست» = اسم آرایه (مثل <code>items</code>)، «دسته‌ها» = فیلد برچسب، «مقادیر» = عبارت عددی. ۷ نوع نمودار.</td></tr></table>',
    },
    {
      id: 'layout',
      title: 'چیدمان حرفه‌ای',
      icon: 'line',
      html:
        '<h3>چیدمان مثل حرفه‌ای‌ها</h3>' +
        '<ul>' +
        '<li><b>Snap هوشمند</b>: موقع درگ به شبکه و لبهٔ الِمان‌های دیگر می‌چسبد؛ خط قرمز = هم‌ترازی. <kbd>Alt</kbd> = خاموش.</li>' +
        '<li><b>جابه‌جایی دقیق</b>: فلش‌ها ۱pt، با <kbd>Shift</kbd> ۱۰pt.</li>' +
        '<li><b>چندانتخابی</b>: <kbd>Shift</kbd>+کلیک یا کشیدن کادر روی جای خالی بوم.</li>' +
        '<li><b>هم‌ترازی و توزیع</b>: با ۲+ انتخاب، دکمه‌هایش در تب طراحی ظاهر می‌شود.</li>' +
        '<li><b>نوار شناور</b>: بالای هر انتخاب — کپی، جلو/عقب، حذف.</li>' +
        '<li><b>لایه‌ها</b>: وقتی چیزها روی هم‌اند، از تب لایه‌ها دقیق انتخاب کن.</li>' +
        '<li><b>زوم</b>: <kbd>Ctrl</kbd>+چرخ موس؛ «1:1» اندازهٔ واقعی چاپ، «جا بده» کل صفحه.</li></ul>',
    },
    {
      id: 'templates',
      title: 'قالب‌ها',
      icon: 'image',
      html:
        '<h3>قالب‌های آماده</h3>' +
        '<p class="lead">۲۲ طرح در شش دسته، با پیش‌نمایش زندهٔ واقعی — کلیک کنی، قالب + دادهٔ نمونه‌اش با هم لود می‌شود.</p>' +
        '<p>سند خالی، فاکتور فروش، پیش‌فاکتور، رسید پرداخت، گزارش فروش (با چارت)، سربرگ نامه، برچسب محصول، لیست بسته‌بندی، کارت ویزیت، منوی رستوران، گزارش کارکرد و گواهی‌نامه.</p>' +
        '<div class="callout"><span class="c-ico">🎨</span><span>بهترین راه یادگیری: یک قالب را لود کن و ببین الِمان‌هایش چطور بایند شده‌اند — بعد به سلیقهٔ خودت تغییرش بده.</span></div>',
    },
    {
      id: 'page',
      title: 'صفحه و خروجی',
      icon: 'qrcode',
      html:
        '<h3>تنظیم صفحه و خروجی گرفتن</h3>' +
        '<h4>صفحه (تب طراحی → بخش صفحه)</h4>' +
        '<ul><li><b>اندازه</b>: A4/A5/A3/Letter/Legal یا <b>سفارشی…</b> (به پونت؛ هر میلی‌متر ≈ <code>2.83pt</code> — مثلاً ۱۰×۶ سانتی‌متر ≈ <code>283×170</code>).</li>' +
        '<li><b>جهت کاغذ</b>: عمودی/افقی.</li>' +
        '<li><b>نوشتار</b>: RTL برای فارسی (پیش‌فرض).</li></ul>' +
        '<h4>خروجی</h4>' +
        '<table class="htable"><tr><th>کار</th><th>چطور</th></tr>' +
        '<tr><td>PDF نهایی</td><td>دکمهٔ آبی «دانلود PDF» — فونت فارسی embed شده، متن قابل جست‌وجو.</td></tr>' +
        '<tr><td>ذخیره/بازکردن طرح</td><td>منوی فایل → JSON. این فایل قالب کامل توست.</td></tr>' +
        '<tr><td>ذخیرهٔ خودکار</td><td>همیشه روشن («ذخیره شد ✓» بالای صفحه)؛ مرورگر را ببندی، برمی‌گردد.</td></tr></table>',
    },
    {
      id: 'keys',
      title: 'میان‌برها',
      icon: 'barcode',
      html:
        '<h3>میان‌برهای کیبورد</h3>' +
        '<table class="htable"><tr><th>کلید</th><th>کار</th></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>واگرد / ازنو</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>D</kbd></td><td>کپی انتخاب</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>پالت فرمان</td></tr>' +
        '<tr><td><kbd>Delete</kbd></td><td>حذف انتخاب</td></tr>' +
        '<tr><td>فلش‌ها / <kbd>Shift</kbd>+فلش‌ها</td><td>جابه‌جایی ۱ / ۱۰ پونت</td></tr>' +
        '<tr><td><kbd>Escape</kbd></td><td>لغو انتخاب / بستن پنجره‌ها</td></tr>' +
        '<tr><td><kbd>Shift</kbd>+کلیک</td><td>افزودن/کم‌کردن از انتخاب</td></tr>' +
        '<tr><td><kbd>Alt</kbd> حین درگ</td><td>بدون snap</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+چرخ موس</td><td>زوم</td></tr>' +
        '<tr><td>دابل‌کلیک</td><td>ویرایش سریع متن/بایند</td></tr></table>',
    },
    {
      id: 'faq',
      title: 'رفع اشکال',
      icon: 'ellipse',
      html:
        '<h3>مشکلات رایج</h3>' +
        '<table class="htable"><tr><th>مشکل</th><th>راه‌حل</th></tr>' +
        '<tr><td>فیلد خالی نشان می‌دهد</td><td>مسیر بایند با دادهٔ نمونه نمی‌خواند — تب داده و چیپ‌ها را چک کن.</td></tr>' +
        '<tr><td>«دادهٔ JSON نامعتبر»</td><td>در JSON کاما یا کوتیشن جا افتاده.</td></tr>' +
        '<tr><td>هشدار زیر تب داده</td><td>خطاهای غیرمهلک موتور — سند ساخته می‌شود، آن بخش جا می‌افتد.</td></tr>' +
        '<tr><td>EAN-13 نمی‌آید</td><td>دقیقاً ۱۲ رقم (کنترل خودکار) یا ۱۳ رقم معتبر بده.</td></tr>' +
        '<tr><td>طرحم پرید!</td><td>ذخیرهٔ خودکار همیشه هست — رفرش کن، برمی‌گردد.</td></tr></table>' +
        '<div class="callout"><span class="c-ico">📚</span><span>مرجع کامل‌تر در مخزن: <code>docs/designer-guide.md</code></span></div>',
    },
  ];

  var TOUR_STEPS = [
    {
      sel: '.toolrail',
      title: 'جعبه‌ابزار',
      body: '۱۲ ابزار طراحی. کلیک کن تا به بوم اضافه شود، یا بگیر و بکش تا دقیقاً همان‌جا که می‌خواهی بنشیند.',
    },
    {
      sel: '#page',
      title: 'بوم — کاغذ تو',
      body: 'چیزی که اینجا می‌بینی همان PDF نهایی است. الِمان‌ها را بکش، از گوشه اندازه بده، دابل‌کلیک کن تا متن/بایند را عوض کنی.',
    },
    {
      sel: '.tab[data-tab="design"]',
      title: 'تب طراحی',
      body: 'خواص الِمان انتخاب‌شده: مکان و اندازه، محتوا، ظاهر — به‌علاوهٔ تنظیمات کاغذ (اندازه، جهت).',
    },
    {
      sel: '.tab[data-tab="layers"]',
      title: 'تب لایه‌ها',
      body: 'فهرست همهٔ الِمان‌های صفحه. وقتی چیزها روی هم‌اند، از اینجا دقیق انتخابشان کن.',
    },
    {
      sel: '.tab[data-tab="data"]',
      title: 'تب داده',
      body: 'دادهٔ نمونهٔ JSON و چیپ‌های فیلد. چیپ را بکش روی بوم تا فیلد بایندشده ساخته شود.',
    },
    {
      sel: '#openGallery',
      title: 'قالب‌های آماده',
      body: '۲۲ طرح حرفه‌ای با پیش‌نمایش زنده، جست‌وجو، دسته‌بندی و شش پالت رنگی. بهترین نقطهٔ شروع.',
    },
    {
      sel: '.statusbar',
      title: 'نوار وضعیت',
      body: 'زوم و «جا بده»، اندازهٔ کاغذ، وضعیت انتخاب و نشانگر ذخیرهٔ خودکار — همیشه جلوی چشمت.',
    },
    {
      sel: '#downloadPdf',
      title: 'دانلود PDF',
      body: 'هر وقت آماده بودی، همین دکمه: PDF واقعی با فونت فارسی. راستی: Ctrl+K همهٔ فرمان‌ها را دارد و دکمهٔ «؟» همین راهنما را.',
    },
  ];
  return { HELP_SECTIONS: HELP_SECTIONS, TOUR_STEPS: TOUR_STEPS };
});
