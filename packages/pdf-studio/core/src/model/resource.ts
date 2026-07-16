/**
 * Embedded resources referenced by id (§4). Fonts and images are carried in the
 * template so it is self-contained and portable; large fonts may instead be
 * registered at runtime (§12) and referenced by family id.
 */
import type { FontStyle, FontWeight } from './style';

export interface FontResource {
  id: string;
  family: string;
  weight?: FontWeight;
  style?: FontStyle;
  /** Base64-encoded font bytes (TTF/OTF), or a URL to load at render time. */
  data?: string;
  url?: string;
  /** Persian/Latin/symbol fallback chain by font id (§11A-C). */
  fallback?: string[];
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/svg+xml';

export interface ImageResource {
  id: string;
  mime: ImageMime;
  /** Base64-encoded image bytes, or a URL to load at render time. */
  data?: string;
  url?: string;
  /** Intrinsic pixel size, when known (aids fit/DPI handling). */
  width?: number;
  height?: number;
}

export interface ResourceBundle {
  fonts: FontResource[];
  images: ImageResource[];
}
