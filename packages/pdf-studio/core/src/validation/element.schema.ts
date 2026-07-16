/**
 * Zod schema for the element catalog (§5). Elements are recursive
 * (`container.children`, `list.itemTemplate`), so the union is wrapped in
 * `z.lazy`. It is annotated `z.ZodType<unknown>` (not `z.ZodType<AnyElement>`)
 * on purpose: under `exactOptionalPropertyTypes`, zod's `.optional()` infers
 * `T | undefined` which is intentionally not identical to the model's `?: T`
 * fields, so we do not assert schema↔interface type-equality here. Value-level
 * conformance is proven by tests instead (ADR-0007).
 */
import { z } from 'zod';
import {
  borderSideSchema,
  boxStyleSchema,
  colorSchema,
  directionSchema,
  expressionSchema,
  formatDescriptorSchema,
  partialLocaleSchema,
  ptSchema,
  rectSchema,
  rgbColorSchema,
  typographySchema,
} from './primitives.schema';

const baseElement = z.object({
  id: z.string(),
  bounds: rectSchema,
  rotation: z.number().optional(),
  zIndex: z.number(),
  styleId: z.string().optional(),
  typography: typographySchema.optional(),
  box: boxStyleSchema.optional(),
  conditionalStyles: z
    .array(
      z
        .object({
          when: expressionSchema,
          typography: typographySchema.optional(),
          box: boxStyleSchema.optional(),
        })
        .passthrough(),
    )
    .optional(),
  bookmark: z
    .object({ level: z.number().optional(), title: expressionSchema.optional() })
    .passthrough()
    .optional(),
  link: z
    .union([
      z.object({ kind: z.literal('url'), target: expressionSchema }),
      z.object({ kind: z.literal('page'), target: expressionSchema }),
    ])
    .optional(),
  dataBar: z
    .object({
      value: expressionSchema,
      min: z.number().optional(),
      max: z.number(),
      color: colorSchema,
    })
    .optional(),
  colorScale: z
    .object({
      value: expressionSchema,
      stops: z.array(z.object({ at: z.number(), color: rgbColorSchema })),
    })
    .optional(),
  iconSet: z
    .object({
      value: expressionSchema,
      thresholds: z.array(
        z.object({
          at: z.number(),
          icon: z.enum(['circle', 'square', 'triangleUp', 'triangleDown']),
          color: rgbColorSchema.optional(),
        }),
      ),
    })
    .optional(),
  direction: directionSchema.optional(),
  locale: partialLocaleSchema.optional(),
  visibleWhen: expressionSchema.optional(),
  printWhen: expressionSchema.optional(),
});

const columnWidthSchema = z.union([
  z.object({ kind: z.literal('fixed'), value: ptSchema }),
  z.object({ kind: z.literal('percent'), value: z.number() }),
  z.object({ kind: z.literal('auto') }),
]);

const aggregateSchema = z.enum(['sum', 'avg', 'count', 'min', 'max']);

const tableCellSchema = z
  .object({
    content: expressionSchema.optional(),
    text: z.string().optional(),
    styleId: z.string().optional(),
    aggregate: aggregateSchema.optional(),
    colSpan: z.number().optional(),
    rowSpan: z.number().optional(),
  })
  .passthrough();

const tableColumnSchema = z
  .object({
    id: z.string(),
    width: columnWidthSchema,
    header: tableCellSchema.optional(),
    footer: tableCellSchema.optional(),
    detail: tableCellSchema.optional(),
    group: z.string().optional(),
  })
  .passthrough();

const textRunSchema = z
  .object({
    text: z.string().optional(),
    expr: expressionSchema.optional(),
    fontFamily: z.string().optional(),
    fontSize: ptSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  })
  .passthrough();

const paragraphSchema = z
  .object({
    runs: z.array(textRunSchema),
    align: z.enum(['start', 'center', 'end', 'left', 'right', 'justify']).optional(),
    lineHeight: z.number().optional(),
  })
  .passthrough();

const chartKindSchema = z.enum([
  'bar',
  'column',
  'stackedColumn',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'combo',
  'sparkline',
]);

/** Recursive element union (§5). See file header for the annotation rationale. */
export const elementSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    baseElement.extend({ type: z.literal('staticText'), text: z.string() }).passthrough(),
    baseElement
      .extend({
        type: z.literal('dataField'),
        value: expressionSchema,
        format: formatDescriptorSchema.optional(),
        fallback: z.string().optional(),
      })
      .passthrough(),
    baseElement
      .extend({ type: z.literal('richText'), paragraphs: z.array(paragraphSchema) })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('image'),
        resourceId: z.string().optional(),
        source: expressionSchema.optional(),
        fit: z.enum(['contain', 'cover', 'fill', 'none']).optional(),
        altText: z.string().optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('table'),
        dataset: z.string(),
        columns: z.array(tableColumnSchema),
        repeatHeader: z.boolean().optional(),
        rowStripeStyleId: z.string().optional(),
        border: borderSideSchema.optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('list'),
        dataset: z.string(),
        itemTemplate: z.array(elementSchema),
        itemHeight: ptSchema,
        gap: ptSchema.optional(),
        orientation: z.enum(['vertical', 'horizontal']).optional(),
      })
      .passthrough(),
    baseElement.extend({ type: z.literal('line'), stroke: borderSideSchema }).passthrough(),
    baseElement.extend({ type: z.literal('rectangle') }).passthrough(),
    baseElement.extend({ type: z.literal('ellipse') }).passthrough(),
    baseElement
      .extend({
        type: z.literal('barcode'),
        symbology: z.enum([
          'code128',
          'code39',
          'ean8',
          'ean13',
          'upca',
          'upce',
          'itf',
          'datamatrix',
          'pdf417',
          'aztec',
          'gs1-128',
        ]),
        value: expressionSchema,
        showText: z.boolean().optional(),
        quietZone: ptSchema.optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('qrcode'),
        value: expressionSchema,
        errorCorrection: z.enum(['L', 'M', 'Q', 'H']).optional(),
        quietZone: ptSchema.optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('chart'),
        chartKind: chartKindSchema,
        dataset: z.string(),
        categories: expressionSchema.optional(),
        series: z.array(
          z
            .object({
              name: z.string().optional(),
              values: expressionSchema,
              kind: chartKindSchema.optional(),
            })
            .passthrough(),
        ),
        showLegend: z.boolean().optional(),
        showLabels: z.boolean().optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('crosstab'),
        dataset: z.string(),
        rowGroups: z.array(expressionSchema),
        columnGroups: z.array(expressionSchema),
        measures: z.array(
          z
            .object({
              value: expressionSchema,
              aggregate: aggregateSchema,
              label: z.string().optional(),
            })
            .passthrough(),
        ),
        showTotals: z.boolean().optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('subreport'),
        templateRef: z.string(),
        dataset: expressionSchema,
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('pageField'),
        field: z.enum(['page', 'pageCount', 'currentDate']),
        format: formatDescriptorSchema.optional(),
      })
      .passthrough(),
    baseElement
      .extend({ type: z.literal('container'), children: z.array(elementSchema) })
      .passthrough(),
    baseElement.extend({ type: z.literal('spacer') }).passthrough(),
    baseElement.extend({ type: z.literal('pageBreak') }).passthrough(),
    baseElement
      .extend({
        type: z.literal('formField'),
        fieldKind: z.enum(['text', 'checkbox']),
        fieldName: z.string(),
        defaultValue: expressionSchema.optional(),
        multiline: z.boolean().optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('toc'),
        maxDepth: z.number().optional(),
        lineHeight: z.number().optional(),
      })
      .passthrough(),
    baseElement
      .extend({
        type: z.literal('custom'),
        renderer: z.string(),
        value: expressionSchema.optional(),
        options: z.record(z.unknown()).optional(),
      })
      .passthrough(),
  ]),
);
