/**
 * Resolves layout fonts to embedded pdf-lib {@link PDFFont}s (§10). Custom fonts
 * (TTF/OTF bytes) are embedded **and subset** via fontkit to keep output small;
 * when no custom font matches a family, a Standard-14 fallback keeps rendering
 * working. The real Persian path embeds a bundled Vazirmatn (Phase 3); this
 * provider already supports it — it just needs the bytes supplied.
 */
import { type PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib';
import type { FontStyle, FontWeight } from '../model/style';

export interface FontInput {
  family: string;
  bytes: Uint8Array;
  weight?: FontWeight;
  style?: FontStyle;
}

export interface FontQuery {
  fontFamily?: string;
  bold: boolean;
  italic: boolean;
}

const isBold = (w?: FontWeight): boolean => w === 'bold' || (typeof w === 'number' && w >= 600);

export class FontProvider {
  private readonly custom = new Map<string, PDFFont>();
  private readonly customFamilies = new Set<string>();
  private readonly standard = new Map<string, PDFFont>();

  private constructor(private readonly doc: PDFDocument) {}

  /** Embed every supplied custom font (subset) and prepare the provider. */
  static async create(doc: PDFDocument, fonts: FontInput[] = []): Promise<FontProvider> {
    const provider = new FontProvider(doc);
    for (const font of fonts) {
      const embedded = await doc.embedFont(font.bytes, { subset: true });
      provider.custom.set(
        variantKey(font.family, isBold(font.weight), font.style === 'italic'),
        embedded,
      );
      provider.customFamilies.add(font.family.toLowerCase());
    }
    return provider;
  }

  /** Resolve a font for the given query, falling back to a Standard-14 font. */
  async resolve(query: FontQuery): Promise<PDFFont> {
    const family = query.fontFamily?.toLowerCase();
    if (family && this.customFamilies.has(family)) {
      const exact = this.custom.get(
        variantKey(query.fontFamily as string, query.bold, query.italic),
      );
      if (exact) return exact;
      // Fall back to any registered variant of the same family.
      for (const [key, font] of this.custom) {
        if (key.startsWith(`${family}|`)) return font;
      }
    }
    return this.standardFont(query.bold, query.italic);
  }

  private async standardFont(bold: boolean, italic: boolean): Promise<PDFFont> {
    const name =
      bold && italic
        ? StandardFonts.HelveticaBoldOblique
        : bold
          ? StandardFonts.HelveticaBold
          : italic
            ? StandardFonts.HelveticaOblique
            : StandardFonts.Helvetica;
    const cached = this.standard.get(name);
    if (cached) return cached;
    const font = await this.doc.embedFont(name);
    this.standard.set(name, font);
    return font;
  }
}

const variantKey = (family: string, bold: boolean, italic: boolean): string =>
  `${family.toLowerCase()}|${bold ? 'b' : ''}|${italic ? 'i' : ''}`;
