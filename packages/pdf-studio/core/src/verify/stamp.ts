/**
 * Verifiable Documents (F1) — stamp a tamper-evident mark onto a template.
 *
 * The hash is computed from the **original** template + inputs (before the stamp
 * is added, so there's no circular dependency), then a small `pageFooter` band
 * carrying a QR (the hash, or a verify URL) plus the human-readable short code is
 * appended. Rendering the returned template paints the stamp; verification later
 * recomputes `hashDocument(originalTemplate, input)` and compares.
 */
import { expr } from '../model/expression';
import type { Band } from '../model/band';
import type { QrCodeElement, StaticTextElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import { hashDocument, type VerifyInput } from './verify';

export interface StampOptions extends VerifyInput {
  /** If set, the QR encodes `${verifyUrl}?h=<hash>`; otherwise the raw hash. */
  verifyUrl?: string;
  /** QR side length in points. Default 48. */
  size?: number;
  /** Label shown before the short code. Default 'کد تأیید'. */
  label?: string;
}

/** Escape an arbitrary string into a DSL single-quoted string literal (§9). */
function dslString(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** Return a copy of `template` with a verification stamp (QR + short code). */
export function stampVerification(
  template: PdfTemplate,
  options: StampOptions = {},
): PdfTemplate {
  // StampOptions extends VerifyInput, so it carries data/parameters/now directly
  const { hash, short } = hashDocument(template, options);
  const payload = options.verifyUrl ? `${options.verifyUrl}?h=${hash}` : hash;
  const size = options.size ?? 48;

  const qr: QrCodeElement = {
    id: 'verify-qr',
    type: 'qrcode',
    bounds: { x: 0, y: 0, width: size, height: size },
    zIndex: 9000,
    value: expr(dslString(payload)),
  };
  const code: StaticTextElement = {
    id: 'verify-code',
    type: 'staticText',
    bounds: { x: size + 6, y: size / 2 - 8, width: 220, height: 16 },
    zIndex: 9000,
    // force Latin digits so the hex code stays readable regardless of the
    // document's digit system (a Persian-digit hash would be wrong)
    locale: { digits: 'latn' },
    text: `${options.label ?? 'کد تأیید'}: ${short}`,
  };
  const band: Band = {
    id: 'verify-stamp',
    type: 'pageFooter',
    height: { mode: 'fixed', value: size + 4 },
    elements: [qr, code],
  };

  if (template.sections?.length) {
    const last = template.sections.length - 1;
    const sections = template.sections.map((s, i) =>
      i === last ? { ...s, bands: [...s.bands, band] } : s,
    );
    return { ...template, sections };
  }
  return { ...template, bands: [...template.bands, band] };
}
