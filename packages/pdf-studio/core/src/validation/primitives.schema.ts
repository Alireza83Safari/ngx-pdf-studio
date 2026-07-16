/**
 * Zod schemas for the model's value primitives (units, color, locale, style,
 * format, expression). These mirror the TS interfaces in `../model` (ADR-0007).
 * Leaf value-objects are validated strictly; larger template *nodes* (elements,
 * bands, the template) use `.passthrough()` so forward-compatible unknown fields
 * survive an import → export round-trip (§4 forward-compatibility).
 */
import { z } from 'zod';

export const ptSchema = z.number();

export const sizeSchema = z.object({ width: ptSchema, height: ptSchema });

export const rectSchema = z.object({
  x: ptSchema,
  y: ptSchema,
  width: ptSchema,
  height: ptSchema,
});

export const edgeInsetsSchema = z.object({
  top: ptSchema,
  right: ptSchema,
  bottom: ptSchema,
  left: ptSchema,
});

export const directionSchema = z.enum(['ltr', 'rtl', 'auto']);
export const digitSystemSchema = z.enum(['latn', 'persian']);
export const calendarSchema = z.enum(['gregorian', 'jalali']);
export const languageSchema = z.string().min(1);

export const localeSetupSchema = z.object({
  language: languageSchema,
  digits: digitSystemSchema,
  calendar: calendarSchema,
});

export const partialLocaleSchema = localeSetupSchema.partial();

export const expressionSchema = z.object({ source: z.string() });

export const rgbColorSchema = z
  .object({
    space: z.literal('rgb'),
    r: z.number(),
    g: z.number(),
    b: z.number(),
    a: z.number().optional(),
  })
  .passthrough();

const cmykColorSchema = z
  .object({
    space: z.literal('cmyk'),
    c: z.number(),
    m: z.number(),
    y: z.number(),
    k: z.number(),
    a: z.number().optional(),
  })
  .passthrough();

const spotColorSchema = z
  .object({
    space: z.literal('spot'),
    name: z.string(),
    tint: z.number().optional(),
    approximation: rgbColorSchema,
  })
  .passthrough();

export const colorSchema = z.union([rgbColorSchema, cmykColorSchema, spotColorSchema]);

export const fontWeightSchema = z.union([
  z.literal('normal'),
  z.literal('bold'),
  z.union([
    z.literal(100),
    z.literal(200),
    z.literal(300),
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
    z.literal(800),
    z.literal(900),
  ]),
]);

export const horizontalAlignSchema = z.enum(['start', 'center', 'end', 'left', 'right', 'justify']);

export const typographySchema = z
  .object({
    fontFamily: z.string().optional(),
    fontSize: ptSchema.optional(),
    fontWeight: fontWeightSchema.optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    lineHeight: z.number().optional(),
    letterSpacing: ptSchema.optional(),
    color: colorSchema.optional(),
    align: horizontalAlignSchema.optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    decoration: z.enum(['none', 'underline', 'line-through']).optional(),
    fontFeatures: z.record(z.boolean()).optional(),
  })
  .passthrough();

const borderSideSchema = z.object({
  width: ptSchema,
  color: colorSchema,
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
});
export { borderSideSchema };

const borderSetSchema = z
  .object({
    all: borderSideSchema.optional(),
    top: borderSideSchema.optional(),
    right: borderSideSchema.optional(),
    bottom: borderSideSchema.optional(),
    left: borderSideSchema.optional(),
    radius: ptSchema.optional(),
  })
  .passthrough();

export const boxStyleSchema = z
  .object({
    fill: z.object({ color: colorSchema }).optional(),
    border: borderSetSchema.optional(),
    padding: edgeInsetsSchema.optional(),
    opacity: z.number().optional(),
  })
  .passthrough();

export const namedStyleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    typography: typographySchema.optional(),
    box: boxStyleSchema.optional(),
  })
  .passthrough();

export const formatLocaleOverrideSchema = z
  .object({
    language: languageSchema.optional(),
    digits: digitSystemSchema.optional(),
    calendar: calendarSchema.optional(),
  })
  .passthrough();

export const formatDescriptorSchema = z
  .object({
    kind: z.enum(['text', 'number', 'currency', 'percent', 'date', 'custom', 'money']),
    locale: formatLocaleOverrideSchema.optional(),
    options: z.record(z.unknown()).optional(),
  })
  .passthrough();
