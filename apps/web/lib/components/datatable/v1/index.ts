/**
 * `datatable@1` — one rectangular dataset, shown as a table and/or as line,
 * bar, and scatter plots of the same rows.
 *
 * The block carries the data, not a query: either written out in the payload
 * or produced by an executable payload whose cached result has the same
 * shape. Views never reshape the data; plot views only name which columns
 * take the `x`, `y`, `series`, `tabs`, and `select` roles, and a table view
 * may declare named row filters the reader toggles.
 *
 * `scatter`, `filters`, and `filter_mode` were added to version 1 as optional
 * schema: every payload written before them parses to the same data.
 */

import { z } from 'zod'
import { defineComponent } from '../../types'

/** Roles a plot view assigns to columns, in the order diagnostics report them. */
export const PLOT_ROLES = ['x', 'y', 'series', 'tabs', 'select'] as const
export type PlotRole = (typeof PLOT_ROLES)[number]

/** A cell value a filter compares against, by its text (see `cellLabel`). */
const filterScalar = z.union([z.string(), z.number(), z.boolean(), z.null()])

const filterOperators = z
  .object({
    eq: filterScalar.optional(),
    ne: filterScalar.optional(),
    in: z.array(filterScalar).optional(),
    not_in: z.array(filterScalar).optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
  })
  .strict()
  .refine(
    (operators) => Object.values(operators).some((value) => value !== undefined),
    'needs at least one operator',
  )

/** One column's condition: equal to a value, one of a list, or every given operator. */
export const filterMatcher = z.union([z.array(filterScalar), filterOperators, filterScalar])

const tableFilter = z
  .object({
    label: z.string().min(1),
    where: z
      .record(z.string().min(1), filterMatcher)
      .refine((where) => Object.keys(where).length > 0, 'needs at least one column'),
    default: z.boolean().optional(),
  })
  .strict()

const tableView = z
  .object({
    type: z.literal('table'),
    filters: z.array(tableFilter).optional(),
    filter_mode: z.enum(['any', 'one']).optional(),
  })
  .strict()

const plotView = z
  .object({
    type: z.enum(['line', 'bar', 'scatter']),
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
export type DatatableTableView = z.infer<typeof tableView>
export type DatatableFilter = z.infer<typeof tableFilter>
export type FilterMatcher = z.infer<typeof filterMatcher>

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
    .describe(
      'One or two sentences of context shown under the title, e.g. how the numbers were produced.',
    ),
  views: z
    .array(viewSchema)
    .min(1)
    .default([{ type: 'table' }])
    .describe(
      'How to show the data, in switcher order. `table` needs nothing else; `line`, `bar`, and `scatter` need `x` and `y` column names and accept `series` (one line/bar group or dot colour per distinct value), `tabs` (outer tab strip), and `select` (inner dropdown). The four roles must name four different existing columns. Axes fit the plotted values by default (a `line` view with numeric `x` cells uses a to-scale numeric x axis; `scatter` always plots numeric x and y, one dot per row); set `y_from_zero: true` / `x_from_zero: true` to anchor an axis at zero. A `table` view may add `filters: [{ label, where, default? }]` shown as toggle chips: `where` maps existing column names to a value (text equality), a list of values (any of), or operators `eq`/`ne`/`in`/`not_in`/`lt`/`lte`/`gt`/`gte`, and a row matches when every entry holds. `filter_mode: any` (default) lets the reader combine any active filters with AND; `filter_mode: one` allows one filter at a time plus an `All` chip. `default: true` activates a filter on first render (at most one in `one` mode). Labels are unique within the view. These view types and fields need a current central instance; an older one shows the block verbatim.',
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
  '    filters:',
  '      - label: bf16 only',
  '        where: { run: bf16 }',
  '      - label: fid < 15',
  '        where: { fid: { lt: 15 } }',
  '  - type: line',
  '    x: step',
  '    y: fid',
  '    series: run',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'datatable',
  version: 1,
  description:
    'A table of measured values with optional named row filters, optionally plotted as line, bar, or scatter views of the same rows.',
  useWhen:
    'Use it whenever a document states more than two or three numbers: metrics per step, per configuration, or per host. Write the numbers you actually measured — one row per observation, long format (`run, step, metric, value`) rather than one column per run — and add a `line`/`bar` view when the shape of the numbers is the point, a `scatter` view when the relation between two measured columns is, and table `filters` when readers need to narrow a long table to named subsets. Use an executable payload (`script:`/`code:`) when the numbers come from logs that change; keep the block static when they are final. Do not use it for prose comparisons (plain Markdown), for an interactive plot (`embed@1`), or for a picture of a plot (`figure@1`).',
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
      if (view.type === 'table') {
        const labels = new Set<string>()
        let defaults = 0
        for (const [filterIndex, filter] of (view.filters ?? []).entries()) {
          if (labels.has(filter.label)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['views', index, 'filters', filterIndex, 'label'],
              message: `filter label \`${filter.label}\` is used twice`,
            })
          }
          labels.add(filter.label)
          if (filter.default) defaults += 1
          for (const column of Object.keys(filter.where)) {
            if (known.has(column)) continue
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['views', index, 'filters', filterIndex, 'where', column],
              message: `no column named \`${column}\``,
            })
          }
        }
        if (view.filter_mode === 'one' && defaults > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['views', index, 'filters'],
            message: `\`filter_mode: one\` allows at most one default filter, found ${defaults}`,
          })
        }
        continue
      }
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
    {
      block: example.replace('  - [bf16, 10000, 18.9]', '  - [bf16, 10000]'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    // A view naming a column that does not exist.
    { block: example.replace('    x: step', '    x: epoch'), code: 'WIKI_COMPONENT_INVALID' },
    // Two roles of one view naming the same column.
    {
      block: example.replace('    series: run', '    series: step'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    // A table filter naming a column that does not exist.
    {
      block: example.replace('where: { run: bf16 }', 'where: { host: bf16 }'),
      code: 'WIKI_COMPONENT_INVALID',
    },
  ],
  fixtures: [
    'docs/wiki/finding/W0001-zero-snr-brightness.md',
    'docs/wiki/bottleneck/W0002-edm2-nan-crash.md',
    'docs/wiki/question/W0005-snr-weighting-hf-artifacts.md',
    'docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ],
})
