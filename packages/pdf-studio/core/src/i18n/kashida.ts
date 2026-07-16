/**
 * Kashida (tatweel, «ـ» U+0640) justification for Persian text
 * (§11, ROADMAP ۱.۴). Real Persian typography justifies by *elongating the
 * connection* between joined letters — not by stretching spaces. This module
 * finds the legal elongation points of a line and distributes tatweels across
 * them to consume a width deficit.
 *
 * v1 heuristic (documented in the roadmap): one candidate per word — the
 * **last** legal junction — which matches common naskh typesetting practice
 * and keeps stretches visually calm. Latin-only lines have no candidates and
 * are returned unchanged.
 *
 * The transformation is a pure string edit, applied in layout: both painters
 * draw the same elongated string, so preview and PDF stay identical (§7).
 */

/**
 * Letters that join to the following letter (dual-joining Arabic-script
 * forms used in Persian). Right-joining-only letters (ا د ذ ر ز ژ و …) can
 * never host a kashida after them.
 */
const DUAL_JOINING = 'بپتثجچحخسشصضطظعغفقکگلمنهیئيك';
/** Any Arabic-script letter that can follow an elongation. */
const ARABIC_LETTER = /[ء-يٮ-ۓۺ-ۿ]/;

const isDualJoining = (ch: string): boolean => DUAL_JOINING.indexOf(ch) !== -1;

/**
 * Indices `i` where a tatweel may be inserted between `line[i]` and
 * `line[i+1]` — at most one (the last legal one) per word.
 */
export function kashidaPoints(line: string): number[] {
  const points: number[] = [];
  let wordLast = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    const next = line[i + 1];
    const boundary = next === undefined || next === ' ';
    if (!boundary && isDualJoining(ch) && ARABIC_LETTER.test(next as string)) {
      wordLast = i;
    }
    if (boundary) {
      if (wordLast >= 0) points.push(wordLast);
      wordLast = -1;
    }
  }
  return points;
}

/**
 * Elongate `line` by ~`deficit` width using tatweels of width
 * `tatweelWidth`, distributed round-robin over the line's kashida points.
 * Returns the line unchanged when there is nothing to stretch.
 */
export function justifyLineWithKashida(
  line: string,
  deficit: number,
  tatweelWidth: number,
): string {
  if (deficit <= 0 || tatweelWidth <= 0) return line;
  const points = kashidaPoints(line);
  if (points.length === 0) return line;

  const total = Math.floor(deficit / tatweelWidth);
  if (total <= 0) return line;

  // per-point counts, round-robin so stretch spreads evenly across words
  const counts = new Array<number>(points.length).fill(0);
  for (let k = 0; k < total; k++) counts[k % points.length] = (counts[k % points.length] ?? 0) + 1;

  let out = '';
  let prev = 0;
  points.forEach((pos, i) => {
    out += line.slice(prev, pos + 1) + 'ـ'.repeat(counts[i] as number);
    prev = pos + 1;
  });
  out += line.slice(prev);
  return out;
}
