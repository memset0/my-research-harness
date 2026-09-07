/**
 * `memon-data@1` — a table plus the provenance of the data in it.
 *
 * The payload is YAML: the command or inline script that produced the rows,
 * when it ran, which commit it ran against, and either the rows themselves or
 * a relative CSV/JSON file inside the page bundle.
 */

import { CORE_SCHEMA, load as loadYaml } from 'js-yaml'
import { z } from 'zod'
import { markdownFenceFor } from '../fence'
import {
  parseComponentAttributes,
  WikiComponentBlockError,
  type WikiComponentDescriptor,
  type WikiComponentDiagnostic,
  type WikiComponentLintContext,
} from '../types'

export type MemonDataCell = string | number | boolean | null

export interface MemonDataTable {
  columns: string[]
  rows: MemonDataCell[][]
}

export interface MemonDataV1 {
  title: string | null
  note: string | null
  /** Command line executed from the project root. Mutually exclusive with `code`. */
  script: string | null
  /** Inline script body fed to `runner` on stdin. Mutually exclusive with `script`. */
  code: string | null
  /** Interpreter that reads the script from stdin; only meaningful with `code`. */
  runner: string
  capturedAt: string
  capturedCommit: string | null
  /** `false` when the key is absent — the provenance warning hangs off this. */
  hasCapturedCommit: boolean
  capturedDirty: boolean
  sources: string[]
  /** Inline form. `null` in the file form. */
  table: MemonDataTable | null
  /** File form: bundle-relative CSV or JSON path. `null` in the inline form. */
  file: string | null
}

const DEFAULT_RUNNER = 'python3 -'
const ISO8601_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)$/

const attributes = z
  .object({ title: z.string().min(1).optional() })
  .strict('only the `title` attribute is accepted')

const PAYLOAD_KEYS = new Set([
  'script',
  'code',
  'runner',
  'captured_at',
  'captured_commit',
  'captured_dirty',
  'columns',
  'rows',
  'data',
  'title',
  'note',
  'sources',
])

function invalid(field: string | null, message: string): WikiComponentBlockError {
  return new WikiComponentBlockError('WIKI_DATA_BLOCK_INVALID', field, message)
}

/** Reject absolute paths, URLs, and anything that escapes the bundle. */
function assertBundleRelativePath(value: string): string {
  const segments = value.split('/').filter((segment) => segment !== '.' && segment !== '')
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    segments.length === 0 ||
    segments.includes('..')
  ) {
    throw invalid('data', `\`${value}\` is not a bundle-relative file path`)
  }
  if (!/\.(?:csv|json)$/i.test(value)) {
    throw invalid('data', `\`${value}\` must be a .csv or .json file`)
  }
  return segments.join('/')
}

function readCell(value: unknown, rowIndex: number, cellIndex: number): MemonDataCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  throw invalid('rows', `row ${rowIndex} cell ${cellIndex} is not a scalar value`)
}

function parsePayload(payload: string, rawAttributes: Record<string, string>): MemonDataV1 {
  const attrs = parseComponentAttributes({ name: 'memon-data', version: 1, attributes }, rawAttributes)

  let document: unknown
  try {
    document = loadYaml(payload, { schema: CORE_SCHEMA })
  } catch (cause) {
    throw invalid(null, `payload is not valid YAML: ${(cause as Error).message}`)
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw invalid(null, 'payload must be a YAML mapping')
  }
  const body = document as Record<string, unknown>
  const unknownKey = Object.keys(body).find((key) => !PAYLOAD_KEYS.has(key))
  if (unknownKey) {
    throw invalid(unknownKey, 'field is not supported by memon-data@1')
  }

  const script = body.script
  const code = body.code
  if (script !== undefined && code !== undefined) {
    throw invalid('script', 'a block declares either `script` or `code`, never both')
  }
  if (script === undefined && code === undefined) {
    throw invalid('script', 'a block must declare `script` or `code`')
  }
  if (script !== undefined && (typeof script !== 'string' || script.trim().length === 0)) {
    throw invalid('script', '`script` must be a non-empty command line string')
  }
  if (code !== undefined && (typeof code !== 'string' || code.trim().length === 0)) {
    throw invalid('code', '`code` must be a non-empty script body string')
  }
  if (
    body.runner !== undefined &&
    (typeof body.runner !== 'string' || body.runner.trim().length === 0)
  ) {
    throw invalid('runner', '`runner` must be a non-empty interpreter command string')
  }

  const capturedAt = body.captured_at
  if (typeof capturedAt !== 'string' || !ISO8601_WITH_OFFSET_RE.test(capturedAt)) {
    throw invalid('captured_at', '`captured_at` must be an ISO8601 timestamp with an offset')
  }
  const hasCapturedCommit = body.captured_commit !== undefined
  const capturedCommit = body.captured_commit ?? null
  if (
    capturedCommit !== null &&
    (typeof capturedCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(capturedCommit))
  ) {
    throw invalid('captured_commit', '`captured_commit` must be a 40-character git HEAD or null')
  }
  if (body.captured_dirty !== undefined && typeof body.captured_dirty !== 'boolean') {
    throw invalid('captured_dirty', '`captured_dirty` must be a boolean')
  }

  let sources: string[] = []
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources) || body.sources.some((entry) => typeof entry !== 'string')) {
      throw invalid('sources', '`sources` must be a list of source identifiers')
    }
    sources = body.sources as string[]
  }

  const hasRows = body.rows !== undefined
  const hasFile = body.data !== undefined
  if (hasRows && hasFile) {
    throw invalid('rows', 'a block declares either inline `rows` or a `data` file, never both')
  }
  if (!hasRows && !hasFile) {
    throw invalid('rows', 'a block must declare inline `rows` or a `data` file')
  }

  let table: MemonDataTable | null = null
  let file: string | null = null
  if (hasRows) {
    if (
      !Array.isArray(body.columns) ||
      body.columns.length === 0 ||
      body.columns.some((column) => typeof column !== 'string')
    ) {
      throw invalid('columns', 'the inline form requires `columns` as a non-empty string list')
    }
    if (!Array.isArray(body.rows)) {
      throw invalid('rows', '`rows` must be a list of rows')
    }
    const columns = body.columns as string[]
    table = {
      columns,
      rows: body.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw invalid('rows', `row ${rowIndex} must be a list of ${columns.length} cells`)
        }
        if (row.length !== columns.length) {
          throw invalid(
            'rows',
            `row ${rowIndex} has ${row.length} cells but \`columns\` declares ${columns.length}`,
          )
        }
        return row.map((cell, cellIndex) => readCell(cell, rowIndex, cellIndex))
      }),
    }
  } else {
    if (typeof body.data !== 'string') {
      throw invalid('data', '`data` must be a relative CSV or JSON path')
    }
    file = assertBundleRelativePath(body.data)
  }

  const title = attrs.title ?? (typeof body.title === 'string' ? body.title : null)
  return {
    title,
    note: typeof body.note === 'string' ? body.note : null,
    script: typeof script === 'string' ? script : null,
    code: typeof code === 'string' ? code : null,
    runner: typeof body.runner === 'string' ? body.runner : DEFAULT_RUNNER,
    capturedAt,
    capturedCommit,
    hasCapturedCommit,
    capturedDirty: body.captured_dirty === true,
    sources,
    table,
    file,
  }
}

function lint(data: MemonDataV1, context: WikiComponentLintContext): WikiComponentDiagnostic[] {
  const diagnostics: WikiComponentDiagnostic[] = []
  if (!data.hasCapturedCommit) {
    diagnostics.push({
      code: 'WIKI_DATA_PROVENANCE_MISSING',
      severity: 'warn',
      message:
        '`captured_commit` is missing; record the project HEAD at capture time (or `null` outside a git worktree)',
      line: context.line,
    })
  }
  if (data.file && context.fileExists && !context.fileExists(data.file)) {
    diagnostics.push({
      code: 'WIKI_DATA_BLOCK_INVALID',
      severity: 'error',
      message: `\`data\` file \`${data.file}\` does not exist in the page bundle`,
      line: context.line,
    })
  }
  return diagnostics
}

/** Abbreviated commit as it appears in every caption. */
export function memonDataCommitLabel(data: MemonDataV1): string | null {
  if (!data.capturedCommit) return null
  return data.capturedDirty
    ? `${data.capturedCommit.slice(0, 7)} (dirty)`
    : data.capturedCommit.slice(0, 7)
}

export function memonDataCaption(data: MemonDataV1): string {
  const parts = [`captured ${data.capturedAt}`]
  const commit = memonDataCommitLabel(data)
  if (commit) parts.push(`commit ${commit}`)
  if (data.script) parts.push(`\`${data.script}\``)
  else parts.push(`\`${data.runner}\` on the collection script below`)
  return parts.join(' · ')
}

function markdownCell(cell: MemonDataCell): string {
  if (cell === null) return ''
  return String(cell).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function toMarkdown(data: MemonDataV1): string {
  const blocks: string[] = []
  if (data.title) blocks.push(`**${data.title}**`)
  if (data.table) {
    const header = `| ${data.table.columns.map(markdownCell).join(' | ')} |`
    const rule = `| ${data.table.columns.map(() => '---').join(' | ')} |`
    const rows = data.table.rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`)
    blocks.push([header, rule, ...rows].join('\n'))
  }
  const caption = data.file
    ? `_${memonDataCaption(data)} · data \`${data.file}\`_`
    : `_${memonDataCaption(data)}_`
  blocks.push(caption)
  if (data.note) blocks.push(data.note)
  if (data.code) {
    const code = data.code.replace(/\n$/, '')
    const fence = markdownFenceFor(code)
    blocks.push([fence, code, fence].join('\n'))
  }
  return blocks.join('\n\n')
}

/**
 * Cells arriving from a fetched CSV/JSON file are display-only: anything that
 * is not already a scalar is stringified rather than failing the whole table.
 */
function fetchedCell(value: unknown): MemonDataCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return JSON.stringify(value)
}

function checkedFetchedTable(
  path: string,
  columns: unknown[],
  rows: unknown[][],
): MemonDataTable {
  if (
    columns.length === 0 ||
    columns.some((column) => typeof column !== 'string' || column.length === 0)
  ) {
    throw new Error(`${path} must declare at least one non-empty string column`)
  }
  const typedColumns = columns.map((column) => String(column))
  return {
    columns: typedColumns,
    rows: rows.map((row, rowIndex) => {
      if (row.length !== typedColumns.length) {
        throw new Error(
          `${path} row ${rowIndex} has ${row.length} cells but its header declares ${typedColumns.length}`,
        )
      }
      return row.map(fetchedCell)
    }),
  }
}

/**
 * Parse a fetched `data:` file into the same table shape as the inline form.
 * JSON accepts either `{columns, rows}` or a list of records; CSV uses its
 * header row as the columns.
 */
export function parseMemonDataFile(path: string, text: string): MemonDataTable {
  if (/\.json$/i.test(path)) {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      const records = parsed.filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      )
      if (records.length !== parsed.length) {
        throw new Error(`${path} must be a list of objects or a {columns, rows} object`)
      }
      const columns = [...new Set(records.flatMap((record) => Object.keys(record)))]
      if (columns.length === 0) throw new Error(`${path} has no columns`)
      return checkedFetchedTable(
        path,
        columns,
        records.map((record) => columns.map((key) => fetchedCell(record[key]))),
      )
    }
    if (!parsed || typeof parsed !== 'object' || !('columns' in parsed) || !('rows' in parsed)) {
      throw new Error(`${path} must be a list of objects or a {columns, rows} object`)
    }
    const columns = parsed.columns
    const rows = parsed.rows
    if (
      !Array.isArray(columns) ||
      !Array.isArray(rows) ||
      rows.some((row) => !Array.isArray(row))
    ) {
      throw new Error(`${path} must be a list of objects or a {columns, rows} object`)
    }
    return checkedFetchedTable(path, columns, rows)
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const header = lines.shift()
  if (!header) throw new Error(`${path} is empty`)
  const columns = splitCsvRow(header)
  return checkedFetchedTable(
    path,
    columns,
    lines.map((line) => splitCsvRow(line)),
  )
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }
      if (char === '"') {
        quoted = false
        continue
      }
      current += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

export const memonDataV1: WikiComponentDescriptor<MemonDataV1> = {
  name: 'memon-data',
  version: 1,
  description:
    'A table of measured values shown together with the command, timestamp, and commit that produced it.',
  args: [
    {
      name: 'title',
      scope: 'attribute',
      type: 'string',
      required: false,
      meaning: 'Caption heading; overrides a `title` in the payload.',
    },
    {
      name: 'script',
      scope: 'payload',
      type: 'string',
      required: false,
      meaning:
        'Command line run from the project root that prints `{"columns": [...], "rows": [[...]]}` on stdout. Mutually exclusive with `code`.',
    },
    {
      name: 'code',
      scope: 'payload',
      type: 'string (block scalar)',
      required: false,
      meaning:
        'Inline collection script with the same stdout contract, fed to `runner` on stdin. Mutually exclusive with `script`.',
    },
    {
      name: 'runner',
      scope: 'payload',
      type: 'string',
      required: false,
      default: DEFAULT_RUNNER,
      meaning: 'Interpreter that reads `code` from stdin, e.g. `bash -s`.',
    },
    {
      name: 'captured_at',
      scope: 'payload',
      type: 'ISO8601 with offset',
      required: true,
      meaning: 'When the script was run.',
    },
    {
      name: 'captured_commit',
      scope: 'payload',
      type: 'string | null',
      required: true,
      meaning:
        'Project HEAD at capture time, or `null` outside a git worktree. Missing key warns `WIKI_DATA_PROVENANCE_MISSING`.',
    },
    {
      name: 'captured_dirty',
      scope: 'payload',
      type: 'boolean',
      required: false,
      default: 'false',
      meaning: 'Set when the worktree had uncommitted changes at capture time.',
    },
    {
      name: 'columns',
      scope: 'payload',
      type: 'string[]',
      required: false,
      meaning: 'Inline form: column headers. Required together with `rows`.',
    },
    {
      name: 'rows',
      scope: 'payload',
      type: 'scalar[][]',
      required: false,
      meaning:
        'Inline form: one list of cells per row, each aligned to `columns`. Mutually exclusive with `data`.',
    },
    {
      name: 'data',
      scope: 'payload',
      type: 'relative path',
      required: false,
      meaning:
        'File form: bundle-relative CSV or JSON whose header/keys are the columns. Mutually exclusive with `rows`.',
    },
    {
      name: 'sources',
      scope: 'payload',
      type: 'string[]',
      required: false,
      meaning:
        'Artifacts the data was collected from (`E0017`, `E0017/V0068`, `H0003`, `W0001`, run dir). A source that changed after `captured_at` marks the page stale as `data[<n>]:<source>`.',
    },
    {
      name: 'note',
      scope: 'payload',
      type: 'string',
      required: false,
      meaning: 'One-line reading aid shown under the caption.',
    },
    {
      name: 'title',
      scope: 'payload',
      type: 'string',
      required: false,
      meaning: 'Caption heading when the attribute form is not used.',
    },
  ],
  effect:
    'The dashboard renders a table with a caption carrying the title, `captured_at`, the abbreviated commit (marked dirty when applicable), and either the `script` line or a collapsible "Collection script" panel with `code`. The file form fetches the CSV/JSON through the page asset route and shows an unresolvable-path notice on surfaces without one. `show --format markdown` projects the inline form as a GFM table plus caption and the file form as the caption plus path.',
  useWhen:
    'Use it for any number a reader might want to re-derive: comparison tables, per-run metrics, counts backing a claim. Do not use it for a chart (use `html-embed@1`) or for prose-shaped content that is easier to read as a sentence or a hand-written Markdown table.',
  example: [
    '```memon-data@1 title="FID by preconditioning"',
    'script: python3 scripts/collect_fid.py --exp E0004',
    'captured_at: 2026-05-04T13:00:00+08:00',
    'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
    'sources: [E0004]',
    'columns: [precond, fid]',
    'rows:',
    '  - [karras, 8.91]',
    '  - [edm2, 8.74]',
    '```',
  ].join('\n'),
  invalidExamples: [
    {
      code: 'WIKI_DATA_BLOCK_INVALID',
      block: [
        '```memon-data@1',
        'script: python3 scripts/collect_fid.py',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'columns: [precond, fid]',
        'rows:',
        '  - [karras, 8.91]',
        '  - [edm2]',
        '```',
      ].join('\n'),
    },
    {
      code: 'WIKI_DATA_BLOCK_INVALID',
      block: [
        '```memon-data@1',
        'script: python3 scripts/collect_fid.py',
        'code: |',
        '  print("both forms at once")',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'columns: [precond]',
        'rows: [[karras]]',
        '```',
      ].join('\n'),
    },
    {
      code: 'WIKI_DATA_PROVENANCE_MISSING',
      block: [
        '```memon-data@1',
        'script: python3 scripts/collect_fid.py',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'columns: [precond, fid]',
        'rows:',
        '  - [karras, 8.91]',
        '```',
      ].join('\n'),
    },
    {
      code: 'WIKI_COMPONENT_INVALID',
      block: [
        '```memon-data@1 caption="unknown attribute"',
        'script: python3 scripts/collect_fid.py',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'columns: [precond]',
        'rows: [[karras]]',
        '```',
      ].join('\n'),
    },
  ],
  fixtures: [
    'mock/project-a/docs/wiki/finding/W0001-zero-snr-brightness.md',
    'mock/project-a/docs/wiki/bottleneck/W0002-edm2-nan-crash.md',
    'mock/project-a/docs/wiki/question/W0005-snr-weighting-hf-artifacts.md',
    'mock/project-a/docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ],
  attributes,
  parsePayload,
  lint,
  toMarkdown,
}
