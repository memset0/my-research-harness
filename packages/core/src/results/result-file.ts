// The per-Run result file `<runDir>/result.csv` (FS v9).
//
//   path,stat,value
//   $experiment_schema_version,,2
//   params.optim.lr,,0.0001
//   metrics.eval.clip,mean,0.312
//   metrics.serve.latency_ms,max.p99,140.2
//
// RFC 4180, UTF-8; header first, reserved `$` rows next, value rows in
// insertion order. Only `stats` values span several rows (one per statistic);
// every other row has an empty `stat` cell. `(path, stat)` is unique. An empty
// `value` cell is an explicitly missing value.
//
// The parser keeps the byte span of every record so writers can replace or
// remove exactly the targeted rows and leave every other byte untouched.

import { createHash } from 'node:crypto'
import { type ResultsDiagnostic, resultsDiagnostic } from './diagnostics.js'
import { isReservedResultPath, resultPathError } from './paths.js'
import { parseStatKey } from './vocabulary.js'

export const RESULT_FILE_NAME = 'result.csv'
export const RESULT_FILE_HEADER = 'path,stat,value'
export const RESULT_SCHEMA_VERSION_PATH = '$experiment_schema_version'
/** Every reserved path this release knows. */
export const RESERVED_RESULT_PATHS: readonly string[] = [RESULT_SCHEMA_VERSION_PATH]

export const RESULT_VALUE_TYPES = ['string', 'number', 'boolean', 'enum', 'list', 'stats'] as const
export type ResultValueType = (typeof RESULT_VALUE_TYPES)[number]

export type ResultList = unknown[]
/** A typed result value; `null` is an explicitly missing value. */
export type ResultValue = string | number | boolean | ResultList | null

export interface ResultFileRow {
  /** 1-based line of the record's first character. */
  line: number
  /** Offsets of the record (without its line terminator) and of the next record. */
  start: number
  end: number
  next: number
  /** The record exactly as written. */
  raw: string
  path: string
  /** Empty for a scalar or reserved row. */
  stat: string
  /** Unquoted cell text. */
  value: string
  reserved: boolean
  /** Path and statistic are well-formed (a value row the summary may use). */
  valid: boolean
}

export interface ResultDuplicate {
  path: string
  stat: string
  lines: number[]
}

export interface ParsedResultFile {
  /** File named in diagnostics. */
  file: string
  content: string
  /** Header and CSV structure are readable; false means no row can be trusted. */
  ok: boolean
  bom: boolean
  eol: '\n' | '\r\n'
  endsWithNewline: boolean
  headerLine: number | null
  reservedRows: ResultFileRow[]
  /** Value rows (valid or not) in file order. */
  rows: ResultFileRow[]
  /** The recorded `experiment_schema_version`, or null when missing or invalid. */
  schemaVersion: number | null
  duplicates: ResultDuplicate[]
  diagnostics: ResultsDiagnostic[]
}

// ---------- CSV tokenizer ----------

interface CsvRecord {
  line: number
  start: number
  end: number
  next: number
  fields: string[]
  problem: string | null
}

interface Tokens {
  records: CsvRecord[]
  eol: '\n' | '\r\n' | null
  fatal: { line: number; message: string } | null
}

function tokenize(text: string, from: number): Tokens {
  const records: CsvRecord[] = []
  let eol: Tokens['eol'] = null
  let index = from
  let line = 1
  while (index < text.length) {
    const start = index
    const startLine = line
    const fields: string[] = []
    let field = ''
    let quoted = false
    let inQuotes = false
    let problem: string | null = null
    let terminated = false
    while (index < text.length) {
      const character = text[index]!
      if (inQuotes) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            field += '"'
            index += 2
            continue
          }
          inQuotes = false
          index += 1
          const after = text[index]
          if (after !== undefined && after !== ',' && after !== '\n' && after !== '\r')
            problem ??= 'text follows a closing quote'
          continue
        }
        if (character === '\n') line += 1
        field += character
        index += 1
        continue
      }
      if (character === '"' && field === '' && !quoted) {
        inQuotes = true
        quoted = true
        index += 1
        continue
      }
      if (character === ',') {
        fields.push(field)
        field = ''
        quoted = false
        index += 1
        continue
      }
      if (character === '\n' || character === '\r') {
        const end = index
        const crlf = character === '\r' && text[index + 1] === '\n'
        if (eol === null) eol = crlf ? '\r\n' : '\n'
        index += crlf ? 2 : 1
        line += 1
        fields.push(field)
        records.push({ line: startLine, start, end, next: index, fields, problem })
        terminated = true
        break
      }
      field += character
      index += 1
    }
    if (!terminated) {
      if (inQuotes) {
        return {
          records,
          eol,
          fatal: { line: startLine, message: 'a quoted cell is never closed' },
        }
      }
      fields.push(field)
      records.push({ line: startLine, start, end: index, next: index, fields, problem })
    }
  }
  return { records, eol, fatal: null }
}

// ---------- typed values ----------

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const POSITIVE_INTEGER = /^[1-9]\d*$/

/** A finite number written in JSON number syntax, or null. */
export function parseResultNumber(text: string): number | null {
  if (!JSON_NUMBER.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function parseResultBoolean(text: string): boolean | null {
  return text === 'true' ? true : text === 'false' ? false : null
}

/** A JSON array written on one line, or null. */
export function parseResultList(text: string): ResultList | null {
  if (!text.startsWith('[') || /[\r\n]/.test(text)) return null
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export type InterpretedResult = { ok: true; value: ResultValue } | { ok: false; message: string }

/**
 * Read a cell as `type`. An empty cell is an explicitly missing value of any
 * type; a `stats` cell holds one statistic, which is a number.
 */
export function interpretResultText(
  text: string,
  type: ResultValueType,
  options?: readonly (string | number | boolean)[],
): InterpretedResult {
  if (text === '') return { ok: true, value: null }
  switch (type) {
    case 'number':
    case 'stats': {
      const value = parseResultNumber(text)
      return value === null
        ? { ok: false, message: `"${text}" is not a finite number` }
        : { ok: true, value }
    }
    case 'boolean': {
      const value = parseResultBoolean(text)
      return value === null
        ? { ok: false, message: `"${text}" is not true or false` }
        : { ok: true, value }
    }
    case 'list': {
      const value = parseResultList(text)
      return value === null
        ? { ok: false, message: `"${text}" is not a one-line JSON array` }
        : { ok: true, value }
    }
    case 'enum': {
      const option = (options ?? []).find((candidate) => String(candidate) === text)
      return option === undefined
        ? {
            ok: false,
            message: `"${text}" is not one of the options ${(options ?? []).map((value) => JSON.stringify(value)).join(', ')}`,
          }
        : { ok: true, value: option }
    }
    default:
      return { ok: true, value: text }
  }
}

/**
 * The type of an undeclared scalar path from the texts it was recorded with:
 * `number`, `boolean` or `list` when every non-empty text parses as such,
 * otherwise `string`.
 */
export function inferScalarResultType(
  texts: Iterable<string>,
): 'number' | 'boolean' | 'list' | 'string' {
  const values = [...texts].filter((text) => text !== '')
  if (values.length === 0) return 'string'
  if (values.every((text) => parseResultNumber(text) !== null)) return 'number'
  if (values.every((text) => parseResultBoolean(text) !== null)) return 'boolean'
  if (values.every((text) => parseResultList(text) !== null)) return 'list'
  return 'string'
}

/** Read an inferred scalar type back from its text. */
export function readInferredResultValue(
  text: string,
  type: 'number' | 'boolean' | 'list' | 'string',
): ResultValue {
  const read = interpretResultText(text, type)
  return read.ok ? read.value : text
}

/** The cell text of a typed value (numbers in their shortest round-trip spelling). */
export function encodeResultValue(value: ResultValue): string {
  if (value === null) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('result numbers must be finite')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return JSON.stringify(value)
  return value
}

/** RFC 4180 quoting: only cells containing a comma, quote or line break are quoted. */
export function quoteResultCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function formatResultRecord(
  path: string,
  stat: string | null | undefined,
  value: string,
): string {
  return `${quoteResultCell(path)},${quoteResultCell(stat ?? '')},${quoteResultCell(value)}`
}

export function resultContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// ---------- parser ----------

function pairKey(path: string, stat: string): string {
  return `${path}\u0000${stat}`
}

/** Parse a result file; never throws. Diagnostics name `file`. */
export function parseResultFile(
  content: string,
  file: string = RESULT_FILE_NAME,
): ParsedResultFile {
  const bom = content.charCodeAt(0) === 0xfeff
  const diagnostics: ResultsDiagnostic[] = []
  const parsed: ParsedResultFile = {
    file,
    content,
    ok: false,
    bom,
    eol: '\n',
    endsWithNewline: /[\r\n]$/.test(content),
    headerLine: null,
    reservedRows: [],
    rows: [],
    schemaVersion: null,
    duplicates: [],
    diagnostics,
  }
  const tokens = tokenize(content, bom ? 1 : 0)
  if (tokens.eol) parsed.eol = tokens.eol
  if (tokens.fatal) {
    diagnostics.push(
      resultsDiagnostic('RESULT_CSV_INVALID', 'error', file, tokens.fatal.message, {
        line: tokens.fatal.line,
      }),
    )
    return parsed
  }
  const records = tokens.records.filter((record) => record.start !== record.end)
  const header = records[0]
  if (
    !header ||
    header.fields.length !== 3 ||
    header.fields[0] !== 'path' ||
    header.fields[1] !== 'stat' ||
    header.fields[2] !== 'value'
  ) {
    diagnostics.push(
      resultsDiagnostic(
        'RESULT_HEADER_INVALID',
        'error',
        file,
        `the first line must be the header "${RESULT_FILE_HEADER}"`,
        { line: header?.line ?? 1 },
      ),
    )
    return parsed
  }
  parsed.ok = true
  parsed.headerLine = header.line
  let sawValueRow = false
  const reservedSeen = new Map<string, number>()
  for (const record of records.slice(1)) {
    const raw = content.slice(record.start, record.end)
    if (record.problem !== null) {
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_CSV_INVALID',
          'error',
          file,
          `${record.problem}; the row is ignored`,
          {
            line: record.line,
          },
        ),
      )
      continue
    }
    if (record.fields.length !== 3) {
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_ROW_INVALID',
          'error',
          file,
          `expected 3 cells (path,stat,value), found ${record.fields.length}; the row is ignored`,
          { line: record.line },
        ),
      )
      continue
    }
    const [path, stat, value] = record.fields as [string, string, string]
    const row: ResultFileRow = {
      line: record.line,
      start: record.start,
      end: record.end,
      next: record.next,
      raw,
      path,
      stat,
      value,
      reserved: isReservedResultPath(path),
      valid: true,
    }
    if (row.reserved) {
      row.valid = false
      parsed.reservedRows.push(row)
      if (sawValueRow)
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_RESERVED_ROW_ORDER',
            'error',
            file,
            `reserved row ${path} must precede every value row`,
            { line: row.line, field: path },
          ),
        )
      if (!RESERVED_RESULT_PATHS.includes(path)) {
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_RESERVED_PATH_UNKNOWN',
            'error',
            file,
            `${path} is not a reserved path known to memon (paths beginning with "$" are reserved)`,
            { line: row.line, field: path },
          ),
        )
        continue
      }
      if (stat !== '')
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_RESERVED_ROW_STAT',
            'error',
            file,
            `reserved row ${path} must have an empty stat cell`,
            { line: row.line, field: path },
          ),
        )
      const previous = reservedSeen.get(path)
      if (previous !== undefined) {
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_RESERVED_ROW_DUPLICATE',
            'error',
            file,
            `reserved row ${path} occurs on lines ${previous} and ${row.line}`,
            { line: row.line, field: path },
          ),
        )
        continue
      }
      reservedSeen.set(path, row.line)
      if (path === RESULT_SCHEMA_VERSION_PATH) {
        if (POSITIVE_INTEGER.test(value)) parsed.schemaVersion = Number(value)
        else
          diagnostics.push(
            resultsDiagnostic(
              'RESULT_SCHEMA_VERSION_INVALID',
              'error',
              file,
              `${path} must be a positive integer, found "${value}"`,
              { line: row.line, field: path },
            ),
          )
      }
      continue
    }
    sawValueRow = true
    const pathError = resultPathError(path)
    if (pathError !== null) {
      row.valid = false
      diagnostics.push(
        resultsDiagnostic('RESULT_PATH_INVALID', 'error', file, `invalid path: ${pathError}`, {
          line: row.line,
          field: path,
        }),
      )
    }
    if (stat !== '') {
      if (parseStatKey(stat) === null) {
        row.valid = false
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_STAT_UNKNOWN',
            'error',
            file,
            `statistic "${stat}" of ${path} is not in the statistic vocabulary; the row is kept but not summarized`,
            { line: row.line, field: path },
          ),
        )
      } else if (value !== '' && parseResultNumber(value) === null) {
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_VALUE_TYPE_MISMATCH',
            'error',
            file,
            `statistic ${stat} of ${path} must be a finite number, found "${value}"`,
            { line: row.line, field: path },
          ),
        )
      }
    }
    parsed.rows.push(row)
  }
  if (!reservedSeen.has(RESULT_SCHEMA_VERSION_PATH))
    diagnostics.push(
      resultsDiagnostic(
        'RESULT_SCHEMA_VERSION_MISSING',
        'error',
        file,
        `${RESULT_SCHEMA_VERSION_PATH} row is missing; add "${RESULT_SCHEMA_VERSION_PATH},,<experiment_schema_version>" as the second line`,
      ),
    )
  const byPair = new Map<string, ResultFileRow[]>()
  for (const row of parsed.rows) {
    const key = pairKey(row.path, row.stat)
    const list = byPair.get(key)
    if (list) list.push(row)
    else byPair.set(key, [row])
  }
  for (const list of byPair.values()) {
    if (list.length < 2) continue
    const first = list[0]!
    const lines = list.map((row) => row.line)
    parsed.duplicates.push({ path: first.path, stat: first.stat, lines })
    diagnostics.push(
      resultsDiagnostic(
        'RESULT_DUPLICATE_ROW',
        'error',
        file,
        `(${first.path}, ${first.stat === '' ? '<empty>' : first.stat}) occurs on lines ${lines.join(', ')}; keep exactly one row`,
        { line: list[1]!.line, field: first.path },
      ),
    )
  }
  diagnostics.push(...structureConflicts(parsed))
  return parsed
}

function structureConflicts(parsed: ParsedResultFile): ResultsDiagnostic[] {
  const diagnostics: ResultsDiagnostic[] = []
  const valid = parsed.rows.filter((row) => row.valid)
  const paths = [...new Set(valid.map((row) => row.path))]
  const sorted = [...paths].sort()
  for (const path of paths) {
    const child = sorted.find((other) => other.startsWith(`${path}.`))
    if (child !== undefined)
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_PATH_CONFLICT',
          'error',
          parsed.file,
          `${path} is recorded as a value and is also the group of ${child}`,
          { field: path, line: valid.find((row) => row.path === path)!.line },
        ),
      )
  }
  const shapes = new Map<string, { scalar?: number; stats?: number; levels: Set<number> }>()
  for (const row of valid) {
    const shape = shapes.get(row.path) ?? { levels: new Set<number>() }
    if (row.stat === '') shape.scalar ??= row.line
    else {
      shape.stats ??= row.line
      shape.levels.add(row.stat.includes('.') ? 2 : 1)
    }
    shapes.set(row.path, shape)
  }
  for (const [path, shape] of shapes) {
    if (shape.scalar !== undefined && shape.stats !== undefined)
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_TYPE_CONFLICT',
          'error',
          parsed.file,
          `${path} is recorded both as a scalar (line ${shape.scalar}) and as statistics (line ${shape.stats})`,
          { field: path, line: shape.stats },
        ),
      )
    if (shape.levels.size > 1)
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_STAT_LEVEL_MIXED',
          'error',
          parsed.file,
          `${path} mixes one-level and two-level (<inner>.<outer>) statistics`,
          { field: path, line: shape.stats },
        ),
      )
  }
  return diagnostics
}

// ---------- entries ----------

/** The rows of one path: its scalar row and its statistic rows. */
export interface ResultFileEntry {
  path: string
  scalar: ResultFileRow | null
  stats: Map<string, ResultFileRow>
}

/** Valid value rows grouped by path, in first-appearance order (first row of a duplicate wins). */
export function resultFileEntries(parsed: ParsedResultFile): Map<string, ResultFileEntry> {
  const entries = new Map<string, ResultFileEntry>()
  for (const row of parsed.rows) {
    if (!row.valid) continue
    let entry = entries.get(row.path)
    if (!entry) {
      entry = { path: row.path, scalar: null, stats: new Map() }
      entries.set(row.path, entry)
    }
    if (row.stat === '') entry.scalar ??= row
    else if (!entry.stats.has(row.stat)) entry.stats.set(row.stat, row)
  }
  return entries
}

/** What a declared column requires of the rows recorded for its path. */
export interface ResultColumnShape {
  path: string
  type: ResultValueType
  options?: readonly (string | number | boolean)[]
  /** Outer dimension: statistics of this column are two-level. */
  over?: string | null
}

/** Declared-type checks of one parsed file (undeclared paths are never errors). */
export function checkResultFileTypes(
  parsed: ParsedResultFile,
  columns: ReadonlyMap<string, ResultColumnShape>,
): ResultsDiagnostic[] {
  const diagnostics: ResultsDiagnostic[] = []
  for (const entry of resultFileEntries(parsed).values()) {
    const column = columns.get(entry.path)
    if (!column) continue
    if (column.type === 'stats') {
      if (entry.scalar)
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_VALUE_TYPE_MISMATCH',
            'error',
            parsed.file,
            `${entry.path} is declared stats: record one row per statistic (path,<stat>,value), not a scalar row`,
            { field: entry.path, line: entry.scalar.line },
          ),
        )
      const twoLevel = typeof column.over === 'string' && column.over.length > 0
      for (const [stat, row] of entry.stats) {
        if (stat.includes('.') !== twoLevel)
          diagnostics.push(
            resultsDiagnostic(
              'RESULT_STAT_LEVEL_MISMATCH',
              'error',
              parsed.file,
              twoLevel
                ? `${entry.path} declares over: ${column.over}; write its statistics as <inner>.<outer> (for example max.p99), not "${stat}"`
                : `${entry.path} declares no outer dimension; "${stat}" must be a one-level statistic`,
              { field: entry.path, line: row.line },
            ),
          )
      }
      continue
    }
    for (const row of entry.stats.values())
      diagnostics.push(
        resultsDiagnostic(
          'RESULT_STAT_ON_SCALAR',
          'error',
          parsed.file,
          `${entry.path} is declared ${column.type}; its row must have an empty stat cell, found "${row.stat}"`,
          { field: entry.path, line: row.line },
        ),
      )
    if (entry.scalar) {
      const read = interpretResultText(entry.scalar.value, column.type, column.options)
      if (!read.ok)
        diagnostics.push(
          resultsDiagnostic(
            'RESULT_VALUE_TYPE_MISMATCH',
            'error',
            parsed.file,
            `${entry.path} is declared ${column.type}: ${read.message}`,
            { field: entry.path, line: entry.scalar.line },
          ),
        )
    }
  }
  return diagnostics
}

/**
 * Conflicts between the result files of one Experiment: a path recorded as a
 * scalar in one file and as statistics in another (`RESULT_TYPE_CONFLICT`),
 * and a path recorded as a value in one file and as a group in another
 * (`RESULT_PATH_CONFLICT`).
 */
export function checkResultFilesConsistency(
  files: ReadonlyArray<{ file: string; parsed: ParsedResultFile }>,
): ResultsDiagnostic[] {
  const scalarIn = new Map<string, string[]>()
  const statsIn = new Map<string, string[]>()
  const valuePaths = new Map<string, string[]>()
  for (const { file, parsed } of files) {
    for (const entry of resultFileEntries(parsed).values()) {
      const add = (map: Map<string, string[]>) => {
        const list = map.get(entry.path) ?? []
        if (!list.includes(file)) list.push(file)
        map.set(entry.path, list)
      }
      if (entry.scalar) add(scalarIn)
      if (entry.stats.size > 0) add(statsIn)
      add(valuePaths)
    }
  }
  const diagnostics: ResultsDiagnostic[] = []
  for (const [path, scalarFiles] of scalarIn) {
    const statsFiles = statsIn.get(path)
    if (!statsFiles) continue
    const onlyScalar = scalarFiles.filter((file) => !statsFiles.includes(file))
    const onlyStats = statsFiles.filter((file) => !scalarFiles.includes(file))
    if (onlyScalar.length === 0 || onlyStats.length === 0) continue
    diagnostics.push(
      resultsDiagnostic(
        'RESULT_TYPE_CONFLICT',
        'error',
        onlyStats[0]!,
        `${path} is recorded as a scalar in ${onlyScalar.join(', ')} and as statistics in ${onlyStats.join(', ')}`,
        { field: path },
      ),
    )
  }
  const sorted = [...valuePaths.keys()].sort()
  for (const [path, files] of valuePaths) {
    const child = sorted.find((other) => other.startsWith(`${path}.`))
    if (child === undefined) continue
    const childFiles = valuePaths.get(child)!
    if (
      childFiles.every((file) => files.includes(file)) &&
      files.every((file) => childFiles.includes(file))
    )
      continue // reported per file by the parser
    diagnostics.push(
      resultsDiagnostic(
        'RESULT_PATH_CONFLICT',
        'error',
        files[0]!,
        `${path} is recorded as a value in ${files.join(', ')} and is the group of ${child} in ${childFiles.join(', ')}`,
        { field: path },
      ),
    )
  }
  return diagnostics
}

// ---------- writing ----------

export interface ResultFileRowInput {
  path: string
  stat?: string | null
  /** Cell text. */
  value: string
}

/** A complete new result file: header, version row, rows; LF line endings. */
export function serializeResultFile(
  schemaVersion: number,
  rows: readonly ResultFileRowInput[],
  eol: '\n' | '\r\n' = '\n',
): string {
  const lines = [
    RESULT_FILE_HEADER,
    formatResultRecord(RESULT_SCHEMA_VERSION_PATH, '', String(schemaVersion)),
    ...rows.map((row) => formatResultRecord(row.path, row.stat ?? '', row.value)),
  ]
  return `${lines.join(eol)}${eol}`
}

export type ResultFileEditErrorCode =
  | 'RESULT_FILE_INVALID'
  | 'RESULT_SCHEMA_MISMATCH'
  | 'RESULT_DUPLICATE_ROW'
  | 'BAD_REQUEST'

export class ResultFileEditError extends Error {
  constructor(
    readonly code: ResultFileEditErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ResultFileEditError'
  }
}

export interface ResultPair {
  path: string
  stat?: string | null
}

export interface ResultFileEdit {
  /** The version a created file records, and the one an existing file must record. */
  schemaVersion: number
  set?: readonly ResultFileRowInput[]
  unset?: readonly ResultPair[]
}

export interface ResultFileEditResult {
  content: string
  created: boolean
  changed: boolean
  replaced: number
  appended: number
  removed: number
}

/**
 * Upsert and unset rows. An existing `(path, stat)` row is rewritten in
 * place, a new pair is appended, an unset pair is removed with its line
 * terminator; every other byte stays as it was. A missing file (`null`) is
 * created with the header and the version row.
 */
export function editResultFileContent(
  content: string | null,
  edit: ResultFileEdit,
): ResultFileEditResult {
  const sets = new Map<string, ResultFileRowInput>()
  for (const row of edit.set ?? []) sets.set(pairKey(row.path, row.stat ?? ''), row)
  const unsets = new Set((edit.unset ?? []).map((pair) => pairKey(pair.path, pair.stat ?? '')))
  for (const key of unsets)
    if (sets.has(key))
      throw new ResultFileEditError(
        'BAD_REQUEST',
        `${key.replace('\u0000', ':')} is both set and unset in one write`,
      )
  if (content === null) {
    const rows = [...sets.values()]
    return {
      content: serializeResultFile(edit.schemaVersion, rows),
      created: true,
      changed: true,
      replaced: 0,
      appended: rows.length,
      removed: 0,
    }
  }
  const parsed = parseResultFile(content)
  if (!parsed.ok)
    throw new ResultFileEditError(
      'RESULT_FILE_INVALID',
      `the result file is not a readable result table: ${parsed.diagnostics.map((item) => item.message).join('; ')}`,
    )
  if (parsed.schemaVersion !== edit.schemaVersion)
    throw new ResultFileEditError(
      'RESULT_SCHEMA_MISMATCH',
      `the result file records experiment_schema_version ${parsed.schemaVersion ?? 'none'}, the Experiment is at ${edit.schemaVersion}`,
      { recorded: parsed.schemaVersion, expected: edit.schemaVersion },
    )
  const rowsByPair = new Map<string, ResultFileRow[]>()
  for (const row of parsed.rows) {
    const key = pairKey(row.path, row.stat)
    rowsByPair.set(key, [...(rowsByPair.get(key) ?? []), row])
  }
  for (const key of [...sets.keys(), ...unsets]) {
    const rows = rowsByPair.get(key) ?? []
    if (rows.length > 1)
      throw new ResultFileEditError(
        'RESULT_DUPLICATE_ROW',
        `(${key.replace('\u0000', ', ')}) occurs on lines ${rows.map((row) => row.line).join(', ')}; remove the duplicate first`,
        { lines: rows.map((row) => row.line) },
      )
  }
  const edits: Array<{ start: number; end: number; text: string }> = []
  const appends: string[] = []
  let replaced = 0
  let removed = 0
  for (const [key, row] of sets) {
    const existing = rowsByPair.get(key)?.[0]
    const record = formatResultRecord(row.path, row.stat ?? '', row.value)
    if (!existing) {
      appends.push(record)
      continue
    }
    if (existing.value === row.value) continue
    edits.push({ start: existing.start, end: existing.end, text: record })
    replaced += 1
  }
  for (const key of unsets) {
    const existing = rowsByPair.get(key)?.[0]
    if (!existing) continue
    edits.push({ start: existing.start, end: existing.next, text: '' })
    removed += 1
  }
  let next = content
  for (const change of edits.sort((left, right) => right.start - left.start))
    next = `${next.slice(0, change.start)}${change.text}${next.slice(change.end)}`
  if (appends.length > 0) {
    if (next.length > 0 && !/[\r\n]$/.test(next)) next += parsed.eol
    next += appends.map((record) => `${record}${parsed.eol}`).join('')
  }
  return {
    content: next,
    created: false,
    changed: next !== content,
    replaced,
    appended: appends.length,
    removed,
  }
}
