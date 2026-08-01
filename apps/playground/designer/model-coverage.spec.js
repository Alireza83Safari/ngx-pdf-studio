/**
 * The guard against the gap this whole phase existed to close (designer-ux 4.3).
 *
 * The engine kept growing and the inspector did not: `justify`, italic,
 * underline, strike-through, line height, letter spacing, vertical alignment,
 * every border property, corner radius, padding and opacity were all in the
 * model and unreachable from the UI — some for so long that nobody remembered
 * they existed. Each was found by hand.
 *
 * So this reads the model's own field names out of `style.ts` and requires that
 * each one is either wired to a named control in `designer.js`, or listed below
 * with a reason it is not. Adding a property to the model without doing one of
 * those two things fails the build, which is the only way the gap stays shut.
 */
const { readFileSync } = require('fs');
const { join } = require('path');

const MODEL = join(__dirname, '../../../packages/pdf-studio/core/src/model/style.ts');
const DESIGNER = join(__dirname, 'designer.js');

/** Field names declared by one `export interface Name { … }` block. */
function fieldsOf(source, interfaceName) {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  if (start < 0) throw new Error(`interface ${interfaceName} not found in style.ts`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  const names = [];
  // `name?: type;` / `name: type;` at the top level of the block, skipping the
  // contents of any nested object type
  let nest = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (nest === 0) {
      const m = /^([A-Za-z_][\w]*)\??\s*:/.exec(trimmed);
      if (m) names.push(m[1]);
    }
    nest += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  return names;
}

/**
 * How each model property reaches the user.
 *
 * `controls` are `data-prop` values in the inspector; several may serve one
 * property (a `BorderSet` is one shape edited by six fields). `why` records a
 * deliberate omission, and must say what would have to change to lift it —
 * a reason that cannot be acted on is just an excuse.
 */
const EXPOSURE = {
  Typography: {
    fontFamily: { controls: ['fontFamily'] },
    fontSize: { controls: ['fontSize'] },
    fontWeight: { controls: ['bold'] },
    fontStyle: { controls: ['italic'] },
    lineHeight: { controls: ['lineHeight'] },
    letterSpacing: { controls: ['letterSpacing'] },
    color: { controls: ['color'] },
    align: { controls: ['align'] },
    verticalAlign: { controls: ['verticalAlign'] },
    decoration: { controls: ['underline', 'strike'] },
    fontFeatures: {
      why:
        'pdf-lib exposes no way to hand OpenType features to an embedded font, so ' +
        'honouring it in measurement would guarantee the painters disagree. ' +
        'Lifting this needs pdf-lib’s text encoding forked (designer-ux 1.13).',
    },
  },
  BoxStyle: {
    fill: { controls: ['boxFillOn', 'boxFill'] },
    border: {
      controls: [
        'boxBorderColor',
        'boxBorderWidth',
        'boxBorderStyle',
        // one entry: the four sides are generated from a list, so the source
        // carries the prefix rather than four literals
        'boxSide-',
        'boxRadius',
      ],
    },
    padding: { controls: ['boxPadding'] },
    opacity: { controls: ['boxOpacity'] },
  },
};

const model = readFileSync(MODEL, 'utf8');
const designer = readFileSync(DESIGNER, 'utf8');

/**
 * Is `name` wired to a control? Most are written out whole; the four border
 * sides are generated from a list, so the source holds the prefix followed by a
 * concatenation. Both count — anything looser would start matching by accident.
 */
function hasControl(source, name) {
  if (source.includes(`data-prop="${name}"`)) return true;
  const generated = new RegExp(`data-prop="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*\\+`);
  return generated.test(source);
}

describe('every style property the model accepts is reachable from the designer', () => {
  for (const [interfaceName, exposure] of Object.entries(EXPOSURE)) {
    describe(interfaceName, () => {
      const fields = fieldsOf(model, interfaceName);

      it('declares no field this test does not know about', () => {
        const unknown = fields.filter((f) => !(f in exposure));
        expect(unknown).toEqual([]);
      });

      it('lists no field the model no longer declares', () => {
        const stale = Object.keys(exposure).filter((f) => !fields.includes(f));
        expect(stale).toEqual([]);
      });

      for (const [field, how] of Object.entries(exposure)) {
        if (how.why) {
          it(`${field} is deliberately not exposed, with a reason`, () => {
            expect(how.why.length).toBeGreaterThan(40);
          });
          continue;
        }
        it(`${field} has a control in the inspector`, () => {
          for (const control of how.controls) {
            expect({ field, control, wired: hasControl(designer, control) }).toEqual({
              field,
              control,
              wired: true,
            });
          }
        });
      }
    });
  }
});

describe('the parser this guard depends on', () => {
  it('reads the fields of a real interface', () => {
    // if this ever returns [] the guard above would pass vacuously
    expect(fieldsOf(model, 'Typography').length).toBeGreaterThan(5);
    expect(fieldsOf(model, 'Typography')).toContain('letterSpacing');
  });

  it('skips fields nested inside an object type', () => {
    const src = 'export interface X {\n  a?: string;\n  b?: { inner: number };\n  c: Pt;\n}\n';
    expect(fieldsOf(src, 'X')).toEqual(['a', 'b', 'c']);
  });

  it('fails loudly when the interface is gone', () => {
    expect(() => fieldsOf(model, 'NoSuchInterface')).toThrow(/not found/);
  });

  it('tells a wired control from an absent one', () => {
    expect(hasControl('x data-prop="fontSize" y', 'fontSize')).toBe(true);
    expect(hasControl('x data-prop="boxSide-\' + sd[0] + \'" y', 'boxSide-')).toBe(true);
    expect(hasControl('x data-prop="fontSize" y', 'fontWeight')).toBe(false);
    // a prefix must not pass for a longer name that merely starts the same way
    expect(hasControl('x data-prop="fontSizeExtra" y', 'fontSize')).toBe(false);
  });
});
