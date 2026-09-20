/**
 * `datatable@1` — one rectangular dataset, shown as a table and/or as line
 * and bar plots of the same rows.
 *
 * The block carries the data, not a query: either written out in the payload
 * or produced by an executable payload whose cached result has the same
 * shape. Views never reshape the data; they only name which columns take the
 * `x`, `y`, `series`, `tabs`, and `select` roles.
 */

import { z } from 'zod'
import { defineComponent } from '../../types'

/** Roles a plot view assigns to columns, in the order diagnostics report them. */
export const PLOT_ROLES = ['x', 'y', 'series', 'tabs', 'select'] as const
export type PlotRole = (typeof PLOT_ROLES)[number]

const tableView = z.object({ type: z.literal('table') }).strict()

const plotView = z
  .object({
    type: z.enum(['line', 'bar']),
    x: z.string().min(1),
    y: z.string().min(1),
    series: z.string().min(1).optional(),
    tabs: z.string().min(1).optional(),
    select: z.string().min(1).optional(),
    x_from_zero: z.boolean().optional(),
    y_from_zero: z.boolean().optional(),
  })
  .strict()

export const viewSchema = z.discriminatedUnion('type', [tableView, plotView])

export type DatatableView = z.infer<typeof viewSchema>
export type DatatablePlotView = z.infer<typeof plotView>

const schema = z.object({
  columns: z
    .array(z.string().min(1))
    .min(1)
    .refine((columns) => new Set(columns).size === columns.length, 'column names must be unique')
    .describe('Column names in order; non-empty and unique. Views address columns by these names.'),
  data: z
    .array(z.array(z.unknown()))
    .describe(
      'Rows in display order; every row has exactly one cell per column. Cells may be strings, numbers, booleans, or null.',
    ),
  title: z.string().min(1).optional().describe('Short caption shown above the data.'),
  note: z
    .string()
    .min(1)
    .optional()
    .describe('One or two sentences of context shown under the title, e.g. how the numbers were produced.'),
  views: z
    .array(viewSchema)
    .min(1)
    .default([{ type: 'table' }])
    .describe(
      'How to show the data, in switcher order. `table` needs nothing else; `line` and `bar` need `x` and `y` column names and accept `series` (one line/bar group per distinct value), `tabs` (outer tab strip), and `select` (inner dropdown). The four roles must name four different existing columns. Axes fit the plotted values by default (a `line` view with numeric `x` cells uses a to-scale numeric x axis); set `y_from_zero: true` / `x_from_zero: true` to anchor an axis at zero.',
    ),
})

const example = [
  '```yaml datatable@1 #fid_by_step',
  'title: FID by training step',
  'note: Lower is better. Both runs use the same evaluation seed.',
  'columns: [run, step, fid]',
  'data:',
  '  - [baseline, 10000, 18.4]',
  '  - [baseline, 20000, 14.1]',
  '  - [bf16, 10000, 18.9]',
  '  - [bf16, 20000, 13.2]',
  'views:',
  '  - type: table',
  '  - type: line',
  '    x: step',
  '    y: fid',
  '    series: run',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'datatable',
  version: 1,
  description: 'A table of measured values, optionally plotted as line or bar views of the same rows.',
  useWhen:
    'Use it whenever a document states more than two or three numbers: metrics per step, per configuration, or per host. Write the numbers you actually measured — one row per observation, long format (`run, step, metric, value`) rather than one column per run — and add a `line`/`bar` view when the shape of the numbers is the point. Use an executable payload (`script:`/`code:`) when the numbers come from logs that change; keep the block static when they are final. Do not use it for prose comparisons (plain Markdown), for an interactive plot (`embed@1`), or for a picture of a plot (`figure@1`).',
  schema,
  refine: (data, ctx) => {
    for (const [index, row] of data.data.entries()) {
      if (row.length === data.columns.length) continue
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data', index],
        message: `row has ${row.length} cells but there are ${data.columns.length} columns`,
      })
    }
    const known = new Set(data.columns)
    for (const [index, view] of data.views.entries()) {
      if (view.type === 'table') continue
      const roleOf = new Map<string, PlotRole>()
      for (const role of PLOT_ROLES) {
        const column = view[role]
        if (column === undefined) continue
        if (!known.has(column)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['views', index, role],
            message: `no column named \`${column}\``,
          })
          continue
        }
        const taken = roleOf.get(column)
        if (taken !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['views', index, role],
            message: `column \`${column}\` is already this view's \`${taken}\``,
          })
          continue
        }
        roleOf.set(column, role)
      }
    }
  },
  example,
  invalidExamples: [
    // A row that does not match `columns`.
    { block: example.replace('  - [bf16, 10000, 18.9]', '  - [bf16, 10000]'), code: 'WIKI_COMPONENT_INVALID' },
    // A view naming a column that does not exist.
    { block: example.replace('    x: step', '    x: epoch'), code: 'WIKI_COMPONENT_INVALID' },
    // Two roles of one view naming the same column.
    { block: example.replace('    series: run', '    series: step'), code: 'WIKI_COMPONENT_INVALID' },
  ],
  fixtures: [
    'docs/wiki/finding/W0001-zero-snr-brightness.md',
    'docs/wiki/bottleneck/W0002-edm2-nan-crash.md',
    'docs/wiki/question/W0005-snr-weighting-hf-artifacts.md',
    'docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ],
})
