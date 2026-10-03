// Value conversions of the FS v8 -> v9 Results migration.
//
// v8 `results.yaml` cells are flat scalars, so statistics were often smuggled
// as strings. Each metric cell is classified on its own:
//
//   "0.31 ± 0.02", "0.31 +/- 0.02"        → stats { mean, std }
//   '{"mean": 0.31, "sample_std": 0.02}'  → stats (aliases: sample_std/stdev → std,
//                                            count/eligible_seeds → n, median → p50;
//                                            other keys become sibling leaves <path>_<key>)
//   plain numbers in a stats column        → stats { mean } (MIGRATED_NUMBER_AS_MEAN)
//   '{"a": 1, "b": "x"}'                   → group expansion <path>.a, <path>.b
//   '[1, 2]'                               → list
//
// A column takes the majority convertible shape of its cells (stats counts
// its statistics cells plus the plain numbers that join them as `mean`; a
// group expansion needs every non-empty cell to be a group, because a leaf
// value cannot share a group's path). A cell that does not fit the chosen
// shape stays verbatim on its own (RESULT_CELL_NOT_CONVERTED) and the rest of
// the column still converts; migrated lint then lists that one cell. JSON
// text that stays a string is reported as RESULT_JSON_STRING. W&B URLs and
// type mismatches stay as they are.

import { RESULT_PATH_SEGMENT_REGEX } from '../results/paths.js'
import type { ResultValue } from '../results/result-file.js'
import { isStatName, type StatName } from '../results/vocabulary.js'

export const STAT_ALIASES: Readonly<Record<string, StatName>> = {
  sample_std: 'std',
  stdev: 'std',
  stddev: 'std',
  count: 'n',
  eligible_seeds: 'n',
  median: 'p50',
}

const PLUS_MINUS = /^\s*([-+0-9.eE]+)\s*(?:±|\+\/-)\s*([-+0-9.eE]+)\s*$/

function finite(text: string): number | null {
  const value = Number(text)
  return text.trim() !== '' && Number.isFinite(value) ? value : null
}

/** A segment usable in a result path (invalid characters become `_`). */
export function sanitizeSegment(raw: string): string {
  let segment = raw.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!/^[A-Za-z_]/.test(segment)) segment = `_${segment}`
  return RESULT_PATH_SEGMENT_REGEX.test(segment) ? segment : '_'
}

/** A v8 key (dots separate groups) as path segments under `partition`. */
export function v8KeyPath(
  partition: 'params' | 'metrics' | 'env',
  key: string,
): { path: string; sanitized: boolean } {
  const segments = key.split('.').map((segment) => sanitizeSegment(segment))
  const path = `${partition}.${segments.join('.')}`
  return { path, sanitized: path !== `${partition}.${key}` }
}

function jsonValue(value: unknown): unknown | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

/** A scalar for a result cell (nested values become JSON text). */
function cellValue(value: unknown): ResultValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value
  return JSON.stringify(value)
}

export type ClassifiedCell = { original: ResultValue } & (
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'scalar'; value: ResultValue }
  | {
      kind: 'stats'
      stats: Partial<Record<StatName, number>>
      siblings: Record<string, ResultValue>
      source: 'plus-minus' | 'json'
    }
  | { kind: 'group'; values: Record<string, ResultValue> }
  | { kind: 'list'; value: unknown[] }
  | { kind: 'json-string'; value: string }
)

/** Classify one v8 cell on its own (the column decides what is converted). */
export function classifyV8Cell(value: unknown): ClassifiedCell {
  const original = value === undefined ? null : cellValue(value)
  if (value === null || value === undefined || value === '') return { kind: 'empty', original }
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? { kind: 'number', value, original }
      : { kind: 'scalar', value: String(value), original }
  if (typeof value !== 'string') return { kind: 'scalar', value: original, original }
  const pm = PLUS_MINUS.exec(value)
  if (pm) {
    const mean = finite(pm[1]!)
    const std = finite(pm[2]!)
    if (mean !== null && std !== null)
      return { kind: 'stats', stats: { mean, std }, siblings: {}, source: 'plus-minus', original }
  }
  const parsed = jsonValue(value)
  if (parsed === undefined) return { kind: 'scalar', value, original }
  if (Array.isArray(parsed)) return { kind: 'list', value: parsed, original }
  if (parsed !== null && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>)
    const stats: Partial<Record<StatName, number>> = {}
    const siblings: Record<string, ResultValue> = {}
    for (const [key, item] of entries) {
      const stat = isStatName(key) ? key : STAT_ALIASES[key]
      if (stat && typeof item === 'number' && Number.isFinite(item) && stats[stat] === undefined)
        stats[stat] = item
      else siblings[key] = cellValue(item)
    }
    const informative = Object.keys(stats).some((stat) => stat !== 'n')
    if (informative) return { kind: 'stats', stats, siblings, source: 'json', original }
    if (entries.length > 0 && entries.every(([, item]) => isScalar(item)))
      return {
        kind: 'group',
        values: Object.fromEntries(entries.map(([key, item]) => [key, cellValue(item)])),
        original,
      }
  }
  return { kind: 'json-string', value, original }
}

export type ColumnConversion = 'verbatim' | 'stats' | 'group' | 'list'

/**
 * How a metric column converts: the majority convertible shape of its
 * non-empty cells (ties prefer stats, then list). Numbers count toward stats
 * only when the column has at least one statistics cell; a group expansion
 * needs every non-empty cell to be a group. A column without any convertible
 * shape stays verbatim.
 */
export function columnConversion(cells: readonly ClassifiedCell[]): ColumnConversion {
  const present = cells.filter((cell) => cell.kind !== 'empty')
  if (present.length === 0) return 'verbatim'
  const count = (kind: ClassifiedCell['kind']) =>
    present.filter((cell) => cell.kind === kind).length
  const statsCells = count('stats')
  const stats = statsCells > 0 ? statsCells + count('number') : 0
  const list = count('list')
  const group = count('group')
  if (group === present.length) return 'group'
  if (stats === 0 && list === 0) return 'verbatim'
  return stats >= list ? 'stats' : 'list'
}

/** A converted value written to a result table or a frozen block. */
export interface ConvertedRow {
  path: string
  stat: string | null
  value: ResultValue
}

export interface ConvertedCellRows {
  rows: ConvertedRow[]
  /** Codes of the conversions (or kept strings) of this cell. */
  conversions: string[]
}

/** The rows of one metric cell under its column's conversion. */
export function convertedRows(
  path: string,
  cell: ClassifiedCell,
  conversion: ColumnConversion,
): ConvertedCellRows {
  // An empty value stays missing in a converted column (a null leaf row would
  // be a type mismatch there); a verbatim column keeps the v8 null as it was.
  if (cell.kind === 'empty')
    return {
      rows: conversion === 'verbatim' ? [{ path, stat: null, value: null }] : [],
      conversions: [],
    }
  if (conversion === 'stats' && cell.kind === 'number')
    return {
      rows: [{ path, stat: 'mean', value: cell.value }],
      conversions: ['MIGRATED_NUMBER_AS_MEAN'],
    }
  if (conversion === 'stats' && cell.kind === 'stats')
    return {
      rows: [
        ...Object.entries(cell.stats).map(([stat, value]) => ({
          path,
          stat,
          value: value as number,
        })),
        ...Object.entries(cell.siblings).map(([key, value]) => ({
          path: `${path}_${sanitizeSegment(key)}`,
          stat: null,
          value,
        })),
      ],
      conversions: [cell.source === 'plus-minus' ? 'PLUS_MINUS_TO_STATS' : 'JSON_TO_STATS'],
    }
  if (conversion === 'group' && cell.kind === 'group')
    return {
      rows: Object.entries(cell.values).map(([key, value]) => ({
        path: `${path}.${sanitizeSegment(key)}`,
        stat: null,
        value,
      })),
      conversions: ['JSON_TO_GROUP'],
    }
  if (conversion === 'list' && cell.kind === 'list')
    return { rows: [{ path, stat: null, value: cell.value }], conversions: ['JSON_TO_LIST'] }
  // Verbatim: the v8 value as it was. In a converted column only this cell
  // stays (migrated lint lists it); the rest of the column still converts.
  if (conversion !== 'verbatim')
    return {
      rows: [{ path, stat: null, value: cell.original }],
      conversions: ['RESULT_CELL_NOT_CONVERTED'],
    }
  const kept =
    cell.kind === 'stats' && cell.source === 'plus-minus'
      ? ['RESULT_STATS_NOT_CONVERTED']
      : cell.kind === 'json-string' ||
          cell.kind === 'list' ||
          cell.kind === 'group' ||
          (cell.kind === 'stats' && cell.source === 'json')
        ? ['RESULT_JSON_STRING']
        : []
  return { rows: [{ path, stat: null, value: cell.original }], conversions: kept }
}
