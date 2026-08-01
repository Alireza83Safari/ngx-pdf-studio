/**
 * The in-app copy has to describe the app it ships with (designer-ux 4.2).
 *
 * Phase 3 corrected "9 tools" and "12 templates" across the markdown docs — and
 * missed the same claims inside the help centre and the guided tour, because
 * they were buried in the middle of a 6,000-line file where nobody reads them.
 * They had been wrong for twelve toolbox entries and twenty-two templates.
 *
 * So the numbers are checked against the things they count: the toolbox in
 * `designer.html` and the gallery in `templates.js`.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const content = require('./designer-content');

const html = readFileSync(join(__dirname, 'designer.html'), 'utf8');
const templates = readFileSync(join(__dirname, 'templates.js'), 'utf8');

/** Persian digits, which is how every number in this copy is written. */
function toPersian(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

const allCopy = [
  ...content.HELP_SECTIONS.map((s) => s.title + ' ' + s.html),
  ...content.TOUR_STEPS.map((s) => (s.title || '') + ' ' + (s.body || '')),
].join('\n');

/** Every "<number> <noun>" claim in the copy, as numbers. */
function claimedCounts(noun) {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const found = [];
  const re = new RegExp(`([${persian}]+)\\s*${noun}`, 'g');
  let m;
  while ((m = re.exec(allCopy))) {
    found.push(Number([...m[1]].map((ch) => persian.indexOf(ch)).join('')));
  }
  return found;
}

describe('the in-app copy matches the app', () => {
  const toolCount = (html.match(/data-add="/g) || []).length;
  // Counted by `cat:`, not by `id:`: the palette themes and the category chips
  // are `{ id: … }` objects too, and counting those gave 34 for a 22-template
  // gallery. Only a gallery entry declares which category it belongs to.
  const templateCount = (templates.match(/\bcat: '/g) || []).length;

  it('counts the toolbox and the gallery from the source, not from itself', () => {
    // if either of these ever reads zero the assertions below pass vacuously
    expect(toolCount).toBeGreaterThan(5);
    expect(templateCount).toBeGreaterThan(5);
  });

  it('claims the number of tools the toolbox actually has', () => {
    const claims = claimedCounts('ابزار');
    expect(claims.length).toBeGreaterThan(0); // the copy does talk about tools
    for (const claim of claims) {
      expect({ claimed: claim, actual: toolCount }).toEqual({
        claimed: toolCount,
        actual: toolCount,
      });
    }
  });

  it('claims the number of templates the gallery actually has', () => {
    const claims = claimedCounts('طرح');
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect({ claimed: claim, actual: templateCount }).toEqual({
        claimed: templateCount,
        actual: templateCount,
      });
    }
  });

  it('writes its numbers in Persian, like the rest of the interface', () => {
    // a Latin-digit count would slip past the checks above unnoticed
    expect(allCopy).not.toMatch(/\b\d+\s*(ابزار|طرح)\b/);
  });
});

describe('the copy itself is well-formed', () => {
  it('gives every help section an id, a title and a body', () => {
    for (const s of content.HELP_SECTIONS) {
      expect(typeof s.id).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.html.length).toBeGreaterThan(50);
    }
  });

  it('uses each help section id once, since the nav selects by it', () => {
    const ids = content.HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every tour step at an element that exists in the page', () => {
    // A stale selector highlights nothing and the tour just looks broken, so
    // each is checked against the markup in the form it is written in:
    // `#id`, `.class`, or `.class[attr="value"]`.
    for (const step of content.TOUR_STEPS) {
      expect(typeof step.sel).toBe('string');
      const byId = /^#([\w-]+)$/.exec(step.sel);
      if (byId) {
        expect({ sel: step.sel, found: html.includes(`id="${byId[1]}"`) }).toEqual({
          sel: step.sel,
          found: true,
        });
        continue;
      }
      const cls = /^\.([\w-]+)/.exec(step.sel);
      expect(cls).not.toBeNull();
      const hasClass = new RegExp(`class="[^"]*\\b${cls[1]}\\b`).test(html);
      expect({ sel: step.sel, found: hasClass }).toEqual({ sel: step.sel, found: true });
      // and the attribute filter, when there is one, must match a real attribute
      const attr = /\[([\w-]+)="([^"]+)"\]/.exec(step.sel);
      if (attr) {
        expect({ sel: step.sel, attr: html.includes(`${attr[1]}="${attr[2]}"`) }).toEqual({
          sel: step.sel,
          attr: true,
        });
      }
    }
  });

  it('helps the tour: every step says something', () => {
    for (const step of content.TOUR_STEPS) {
      expect((step.body || '').length).toBeGreaterThan(20);
    }
  });
});

describe('the number parser this guard depends on', () => {
  it('reads Persian digits', () => {
    expect(toPersian(12)).toBe('۱۲');
    expect(toPersian(22)).toBe('۲۲');
  });

  it('finds a claim and returns it as a number', () => {
    // proves the regex actually matches the shape the copy uses
    expect(claimedCounts('ابزار').every((n) => Number.isInteger(n))).toBe(true);
  });
});
