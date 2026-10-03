// Value-to-text helpers and display labels for the Results table.

import type { ResultTableColumn, ResultValue, ResultVariant, SotaRank } from './types'
import type { ResultsViewRowFilterOperator, ResultsViewSortDirection } from './views'

const BR_PATTERN = /<br\s*\/?>/gi
const LINE_BREAK_PATTERN = /(?:<br\s*\/?>|\r?\n)/gi

/** Shared natural, case-insensitive collation used by filters, sorts and domains. */
export const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Raw text of a value; arrays join with newlines; empty values become ''. */
export function valueText(value: ResultValue): string {
  if (Array.isArray(value)) return value.join('\n')
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

/** Text with literal `<br>` markup turned into newlines; '—' when empty. */
export function displayText(value: ResultValue): string {
  return valueText(value).replace(BR_PATTERN, '\n') || '—'
}

/** Plain-text cell value used for the native title tooltip. */
export function plainCellValue(column: ResultTableColumn, variant: ResultVariant): string {
  return column.getText(variant).replace(BR_PATTERN, '\n') || '—'
}

export function isEmptyValue(value: ResultValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** Split displayed text at `<br>` variants and newlines. */
export function splitDisplayLines(value: string): string[] {
  return value.split(LINE_BREAK_PATTERN)
}

/** Pair each line with a stable key that stays unique for repeated lines. */
export function keyedLines(value: string): Array<{ key: string; line: string }> {
  const occurrences = new Map<string, number>()
  return splitDisplayLines(value).map((line) => {
    const occurrence = (occurrences.get(line) ?? 0) + 1
    occurrences.set(line, occurrence)
    return { key: `${line}\0${occurrence}`, line }
  })
}

/**
 * Text for a scalar cell. Finite numbers use `decimalPlaces` when given;
 * everything else (strings, booleans, NaN, ±Infinity) is shown verbatim.
 */
export function formatScalar(
  value: Exclude<ResultValue, string[] | null | undefined>,
  decimalPlaces?: number,
): { text: string; decimalFormatted: boolean } {
  if (decimalPlaces !== undefined && typeof value === 'number' && Number.isFinite(value)) {
    return { text: value.toFixed(decimalPlaces), decimalFormatted: true }
  }
  return { text: String(value), decimalFormatted: false }
}

/**
 * A wandb.ai (or subdomain) http(s) URL with no surrounding whitespace becomes
 * a compact link labelled by its decoded last path segment (else hostname).
 */
export function parseWandbUrl(value: string): { href: string; label: string } | null {
  const href = value.trim()
  if (href !== value || href.length === 0) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const hostname = url.hostname.toLowerCase()
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (hostname !== 'wandb.ai' && !hostname.endsWith('.wandb.ai'))
  ) {
    return null
  }
  const lastSegment = url.pathname.split('/').filter(Boolean).at(-1)
  if (!lastSegment) return { href, label: hostname }
  try {
    return { href, label: decodeURIComponent(lastSegment) }
  } catch {
    return { href, label: lastSegment }
  }
}

export function gitBlobUrl(variant: ResultVariant, path: string): string | null {
  const repository = variant.provenance?.repo
  const commit = variant.provenance?.commit
  if (!repository || !commit || !isSafeRelativePath(path)) return null
  const base = normalizedRepositoryUrl(repository)
  if (!base) return null
  const encodedPath = path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')
  return `${base}/blob/${encodeURIComponent(commit)}/${encodedPath}`
}

export function gitCommitUrl(variant: ResultVariant): string | null {
  const repository = variant.provenance?.repo
  const commit = variant.provenance?.commit
  if (!repository || !commit) return null
  const base = normalizedRepositoryUrl(repository)
  return base ? `${base}/commit/${encodeURIComponent(commit)}` : null
}

export function normalizedRepositoryUrl(repository: string): string | null {
  let url: URL
  try {
    url = new URL(repository)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')
  return url.toString().replace(/\/$/, '')
}

export function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) &&
    !normalized.split('/').includes('..')
  )
}

export function operatorSymbol(operator: ResultsViewRowFilterOperator): string {
  if (operator === 'eq') return '='
  if (operator === 'neq') return '≠'
  if (operator === 'gt') return '>'
  return '<'
}

export function sortDirectionSymbol(direction: ResultsViewSortDirection): string {
  return direction === 'asc' ? '↑' : '↓'
}

export function sortDirectionLabel(direction: ResultsViewSortDirection): string {
  return direction === 'asc' ? 'ascending' : 'descending'
}

export function sortActionLabel(direction: ResultsViewSortDirection | null): string {
  if (direction === 'asc') return 'temporarily sorted ascending; activate for descending'
  if (direction === 'desc') return 'temporarily sorted descending; activate for default sort'
  return 'default sort; activate for temporary ascending'
}

/** Tailwind classes for a SOTA rank: 1 bold+underline, 2 bold, 3 underline. */
export function sotaRankClass(rank: SotaRank | undefined): string {
  if (rank === 1) return 'font-bold underline'
  if (rank === 2) return 'font-bold'
  if (rank === 3) return 'underline'
  return ''
}
