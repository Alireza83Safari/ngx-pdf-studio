/**
 * Resolves a {@link QrCodeElement} to a {@link LaidQr} module matrix (§5), using
 * the vetted `qrcode-generator` encoder (auto version, selectable EC level). The
 * painters draw the matrix as vector squares. Empty/failed encodes are non-fatal
 * (a diagnostic is recorded and nothing is drawn, §9). Verified by a jsQR decode
 * round-trip test.
 */
import qrcode from 'qrcode-generator';
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { QrCodeElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { LaidQr } from './page';

interface Deps {
  ctx: RenderContext;
}

export function resolveQr(
  el: QrCodeElement,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
): LaidQr | undefined {
  const value = evaluateExpr(el.value.source, scope, deps.ctx, locale.digits);
  const text = value == null ? '' : String(value);
  if (text === '') {
    deps.ctx.diagnostics.push({ severity: 'warning', message: `QR code '${el.id}' has no value` });
    return undefined;
  }
  try {
    const qr = qrcode(0, el.errorCorrection ?? 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const modules: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const cols: boolean[] = [];
      for (let col = 0; col < count; col++) cols.push(qr.isDark(row, col));
      modules.push(cols);
    }
    return { modules, count };
  } catch (err) {
    deps.ctx.diagnostics.push({
      severity: 'warning',
      message: `Could not encode QR '${el.id}': ${err instanceof Error ? err.message : String(err)}`,
    });
    return undefined;
  }
}
