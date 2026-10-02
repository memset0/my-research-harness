// Result paths: dotted, grouped names of the values a Run records.
//
//   params.optim.lr        partition `params`, group `params.optim`, leaf `lr`
//   metrics.eval.fid       partition `metrics`
//   env.CUDA_VERSION       partition `env`
//   $experiment_schema_version   reserved (memon-owned) path
//
// A value path has at least two segments, the first being one of the three
// partitions; every segment matches `[A-Za-z_][A-Za-z0-9_-]*` (dots only
// separate segments). A group is any proper prefix of a value path.

export const RESULT_PARTITIONS = ['params', 'metrics', 'env'] as const
export type ResultPartition = (typeof RESULT_PARTITIONS)[number]

export const RESULT_PATH_SEGMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** Paths beginning with `$` are reserved for memon. */
export const RESERVED_RESULT_PATH_PREFIX = '$'

const PARTITION_SET: ReadonlySet<string> = new Set(RESULT_PARTITIONS)

export function isResultPartition(value: string): value is ResultPartition {
  return PARTITION_SET.has(value)
}

export function isReservedResultPath(path: string): boolean {
  return path.startsWith(RESERVED_RESULT_PATH_PREFIX)
}

function segmentsError(path: string, minimum: number): string | null {
  if (path.length === 0) return 'must not be empty'
  const segments = path.split('.')
  if (segments.length < minimum)
    return minimum === 2
      ? `"${path}" must name a value below one of the partitions ${RESULT_PARTITIONS.join(', ')} (for example metrics.fid)`
      : `"${path}" must start with one of the partitions ${RESULT_PARTITIONS.join(', ')}`
  if (!isResultPartition(segments[0]!))
    return `"${path}" must start with one of the partitions ${RESULT_PARTITIONS.join(', ')}`
  const bad = segments.find((segment) => !RESULT_PATH_SEGMENT_REGEX.test(segment))
  if (bad !== undefined)
    return `segment "${bad}" of "${path}" must match ${RESULT_PATH_SEGMENT_REGEX.source}`
  return null
}

/** Why `path` is not a valid value path, or null. */
export function resultPathError(path: string): string | null {
  return segmentsError(path, 2)
}

export function isResultValuePath(path: string): boolean {
  return resultPathError(path) === null
}

/** Why `path` is not a valid group path (a partition or a deeper prefix), or null. */
export function resultGroupPathError(path: string): string | null {
  return segmentsError(path, 1)
}

export function resultPathPartition(path: string): ResultPartition | null {
  const first = path.split('.')[0] ?? ''
  return isResultPartition(first) ? first : null
}

/** The group a value path belongs to (`metrics.eval` for `metrics.eval.fid`). */
export function resultPathParent(path: string): string {
  const index = path.lastIndexOf('.')
  return index < 0 ? '' : path.slice(0, index)
}

/** Every proper prefix of a path, outermost first. */
export function resultPathGroups(path: string): string[] {
  const segments = path.split('.')
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('.'))
}

/** The last segment, the default label of an undeclared column. */
export function resultPathLeaf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1)
}

/** True when `path` equals `prefix` or lies below it. */
export function isResultPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`)
}

/** Replace the group prefix `from` of `path` by `to` (paths outside `from` are returned unchanged). */
export function replaceResultPathPrefix(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}.`)) return `${to}${path.slice(from.length)}`
  return path
}

/** CLI `--group` names of the parameter and metric partitions. */
export const RESULT_GROUP_FILTER_PARTITIONS: Readonly<
  Record<'parameter' | 'metric', ResultPartition>
> = { parameter: 'params', metric: 'metrics' }
