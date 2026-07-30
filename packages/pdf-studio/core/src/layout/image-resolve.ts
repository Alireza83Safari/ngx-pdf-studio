/**
 * Resolves an {@link ImageElement} to a paintable {@link LaidImage} (§5): from
 * an embedded resource (base64/url), or a dynamic `source` expression yielding a
 * `data:` URI or a URL. Missing/unresolvable images are non-fatal (a diagnostic
 * is recorded and nothing is drawn, §9).
 */
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { ImageElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { ImageMime, ImageResource } from '../model/resource';
import type { LaidImage } from './page';

interface Deps {
  ctx: RenderContext;
  images: Map<string, ImageResource>;
}

const DATA_URI = /^data:(image\/(?:png|jpeg|svg\+xml));base64,(.+)$/;

export function resolveImage(
  el: ImageElement,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
): LaidImage | undefined {
  const fit = el.fit ?? 'contain';

  if (el.resourceId) {
    const res = deps.images.get(el.resourceId);
    if (!res) {
      warn(deps, `Image resource '${el.resourceId}' not found`, el.id);
      return undefined;
    }
    return {
      mime: res.mime,
      fit,
      ...(res.data ? { base64: res.data } : {}),
      ...(res.url ? { url: res.url } : {}),
    };
  }

  if (el.source) {
    const value = evaluateExpr(el.source.source, scope, deps.ctx, locale.digits, el.id);
    if (typeof value !== 'string' || value === '') {
      warn(deps, `Image source for '${el.id}' did not resolve to a string`, el.id);
      return undefined;
    }
    const match = DATA_URI.exec(value);
    if (match) return { mime: match[1] as ImageMime, fit, base64: match[2] as string };
    return { mime: 'image/png', fit, url: value };
  }

  return undefined;
}

function warn(deps: Deps, message: string, elementId?: string): void {
  deps.ctx.diagnostics.push({
    severity: 'warning',
    message,
    ...(elementId ? { elementId } : {}),
  });
}
