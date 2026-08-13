/**
 * Which URL schemes the painters are willing to put into a document.
 *
 * A template is code-shaped input (see SECURITY.md), and two of its values reach
 * a place where the scheme decides what *happens* rather than what is displayed:
 *
 *  - an image `source`, which lands in an SVG `href` — and that SVG is handed to
 *    `innerHTML` by the designer and to `bypassSecurityTrustHtml` by the Angular
 *    preview, both deliberately, because Angular's sanitizer strips the
 *    painter's output;
 *  - an element `link`, which becomes a PDF `/URI` action. That one has real
 *    teeth: the viewer acts on the URI, and `javascript:` and `file:` in a link
 *    annotation are longstanding viewer vectors.
 *
 * SECURITY.md told *consumers* to restrict schemes before rendering untrusted
 * templates. That is the wrong place for the default. The designer eats
 * untrusted templates by design — it opens them straight from a `#hash` share
 * link — and a caller who forgets is the common case, not the exception. An
 * allowlist here makes forgetting safe, and a refusal is reported as a
 * diagnostic so nothing disappears in silence.
 *
 * Allowlists, never denylists: a list of blocked schemes is a list of the tricks
 * somebody already thought of.
 */
import type { ExpressionDiagnostic } from '../expression/errors';

/**
 * Drop the characters a URL parser discards before it reads the scheme.
 *
 * `U+0000`–`U+0020` is the whitespace-and-control range browsers strip, which is
 * what makes `java\tscript:` and `  javascript:` reach the same handler as the
 * plain spelling. Removing them before the test is the difference between
 * checking the URL and checking a string that merely looks like it.
 *
 * A scan rather than a regex: a character class over that range is exactly what
 * `no-control-regex` exists to flag, and the rule is right — a control character
 * inside a pattern is unreadable and usually a mistake. Here it is neither, so
 * the answer is to stop needing one rather than to silence the rule.
 */
function clean(url: string): string {
  let out = '';
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x20) out += ch;
  }
  return out;
}

/** The scheme of `url` in lower case, or `null` when it is relative. */
export function urlScheme(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(clean(url));
  return match ? (match[1] as string).toLowerCase() : null;
}

/** Fetchable over the network, or inline. Relative URLs resolve against the host page. */
const IMAGE_SCHEMES = new Set(['http', 'https', 'data']);

/** What a link may point at. `mailto:` is the one non-web scheme worth keeping. */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * May this URL be used as an image source?
 *
 * `data:` is narrowed to image payloads. A `data:text/html` would not render in
 * an `<image>` anyway, so allowing it buys nothing and costs an argument about
 * what some future consumer might do with the same string.
 */
export function isSafeImageUrl(url: string): boolean {
  const scheme = urlScheme(url);
  if (scheme === null) return true; // relative: no scheme, no scheme-driven behaviour
  if (scheme === 'data') return /^data:image\//i.test(clean(url));
  return IMAGE_SCHEMES.has(scheme);
}

/** May this URL be used as a link target? */
export function isSafeLinkUrl(url: string): boolean {
  const scheme = urlScheme(url);
  return scheme === null || LINK_SCHEMES.has(scheme);
}

/** The diagnostic for a refused URL — one wording, wherever it is refused. */
export function refusedUrlDiagnostic(
  kind: 'image' | 'link',
  url: string,
  elementId: string,
): ExpressionDiagnostic {
  const scheme = urlScheme(url);
  return {
    severity: 'warning',
    message:
      `Refused the ${kind} URL on '${elementId}': ` +
      (scheme === null ? 'unsupported form' : `'${scheme}:' is not an allowed scheme`),
    elementId,
  };
}
