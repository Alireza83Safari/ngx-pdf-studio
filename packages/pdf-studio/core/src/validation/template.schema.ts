/**
 * Zod schema for the whole {@link PdfTemplate} (§4). Composes the primitives and
 * element schemas. Template *nodes* use `.passthrough()` so unknown
 * forward-compatible fields survive import → export (§4 forward-compatibility).
 */
import { z } from 'zod';
import { elementSchema } from './element.schema';
import {
  directionSchema,
  edgeInsetsSchema,
  expressionSchema,
  localeSetupSchema,
  namedStyleSchema,
  partialLocaleSchema,
  sizeSchema,
} from './primitives.schema';

const pageSizeSchema = z.union([z.enum(['A3', 'A4', 'A5', 'Letter', 'Legal']), sizeSchema]);

const pageSetupSchema = z
  .object({
    size: pageSizeSchema,
    orientation: z.enum(['portrait', 'landscape']),
    margins: edgeInsetsSchema,
    columns: z.object({ count: z.number(), gap: z.number() }).optional(),
    direction: directionSchema,
    locale: localeSetupSchema,
    unit: z.enum(['pt', 'mm']),
  })
  .passthrough();

const metadataSchema = z
  .object({
    name: z.string(),
    author: z.string().optional(),
    description: z.string().optional(),
    createdAt: z.string().optional(),
    modifiedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const fieldShapeSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      path: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'date', 'object', 'array']).optional(),
      label: z.string().optional(),
      fields: z.array(fieldShapeSchema).optional(),
    })
    .passthrough(),
);

const datasetSourceSchema = z.union([
  z.object({ kind: z.literal('path'), path: z.string() }),
  z.object({ kind: z.literal('expression'), expr: expressionSchema }),
  z.object({
    kind: z.literal('provider'),
    provider: z.string(),
    params: z.record(z.unknown()).optional(),
  }),
]);

const datasetSchema = z
  .object({
    name: z.string(),
    source: datasetSourceSchema,
    shape: z.array(fieldShapeSchema).optional(),
    sortBy: z
      .array(z.object({ expr: expressionSchema, direction: z.enum(['asc', 'desc']) }))
      .optional(),
    filter: expressionSchema.optional(),
    groupBy: z.array(expressionSchema).optional(),
  })
  .passthrough();

const parameterSchema = z
  .object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'color', 'image']),
    label: z.string().optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })
  .passthrough();

const fontResourceSchema = z
  .object({
    id: z.string(),
    family: z.string(),
    weight: z.union([z.string(), z.number()]).optional(),
    style: z.enum(['normal', 'italic']).optional(),
    data: z.string().optional(),
    url: z.string().optional(),
    fallback: z.array(z.string()).optional(),
  })
  .passthrough();

const imageResourceSchema = z
  .object({
    id: z.string(),
    mime: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
    data: z.string().optional(),
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

const resourceBundleSchema = z
  .object({
    fonts: z.array(fontResourceSchema),
    images: z.array(imageResourceSchema),
  })
  .passthrough();

const bandSchema = z
  .object({
    id: z.string(),
    type: z.enum([
      'background',
      'watermark',
      'reportHeader',
      'pageHeader',
      'columnHeader',
      'groupHeader',
      'detail',
      'groupFooter',
      'columnFooter',
      'pageFooter',
      'reportFooter',
    ]),
    height: z.union([
      z.object({ mode: z.literal('fixed'), value: z.number() }),
      z.object({ mode: z.literal('auto'), min: z.number().optional(), max: z.number().optional() }),
    ]),
    elements: z.array(elementSchema),
    dataset: z.string().optional(),
    groupKey: expressionSchema.optional(),
    groupLevel: z.number().optional(),
    direction: directionSchema.optional(),
    locale: partialLocaleSchema.optional(),
    keepTogether: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional(),
    pageBreakAfter: z.boolean().optional(),
    canSplit: z.boolean().optional(),
    master: z.enum(['all', 'first', 'odd', 'even']).optional(),
    visibleWhen: expressionSchema.optional(),
    printWhen: expressionSchema.optional(),
  })
  .passthrough();

/**
 * The full template schema. Annotated `z.ZodType<unknown>` (like
 * `elementSchema`): the composed inferred type is too large for the compiler to
 * serialize into declarations, and we validate against the hand-written
 * {@link PdfTemplate} model rather than zod inference (ADR-0007).
 */
export const templateSchema: z.ZodType<unknown> = z
  .object({
    schemaVersion: z.string(),
    metadata: metadataSchema,
    page: pageSetupSchema,
    styles: z.array(namedStyleSchema),
    datasets: z.array(datasetSchema),
    parameters: z.array(parameterSchema),
    bands: z.array(bandSchema),
    sections: z
      .array(
        z
          .object({
            id: z.string(),
            page: pageSetupSchema,
            bands: z.array(bandSchema),
            restartPageNumbers: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
    variables: z
      .array(
        z
          .object({
            name: z.string(),
            expression: expressionSchema,
            calculation: z.enum(['sum', 'count', 'avg', 'min', 'max', 'first', 'last']),
            reset: z.enum(['report', 'group', 'page']).optional(),
            resetGroupLevel: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
    resources: resourceBundleSchema,
  })
  .passthrough();
