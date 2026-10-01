// Strict canonical IDs for hypotheses (H), digests (D), reports (R),
// experiments (E), and wiki pages (W).
//
// The canonical form is `<P><NNNN>` where <P> is the prefix letter and
// <NNNN> is a 4-digit zero-padded integer in [0001, 9999]. Examples:
//   H0001  — first hypothesis
//   D0042  — digest #42
//   R0123  — report #123
//   E0007  — experiment doc #7 at docs/experiments/E0007-<slug>/
//   W0007  — wiki page #7 at docs/wiki/<kind>/W0007-<slug>{.md,/README.md}
//
// Anything else (unpadded `H1`, overlong `H10000`, wrong prefix `Z0001`)
// is rejected by parseId. Use padId(prefix, n) to format.

export const ID_WIDTH = 4
export const ID_MIN = 1
export const ID_MAX = 9999

export const ID_PREFIXES = ['H', 'D', 'R', 'E', 'W'] as const
export type IdPrefix = (typeof ID_PREFIXES)[number]

/** Strict regex for the canonical form. Group 1 = prefix, group 2 = digits. */
export const ID_REGEX = /^([HDREW])(\d{4})$/

export interface ParsedId {
  prefix: IdPrefix
  /** Integer value (1..9999). Always positive. */
  n: number
}

/** Format an integer as the canonical padded ID. Throws on out-of-range. */
export function padId(prefix: IdPrefix, n: number): string {
  if (!Number.isInteger(n) || n < ID_MIN || n > ID_MAX) {
    throw new RangeError(`padId: n must be an integer in [${ID_MIN}, ${ID_MAX}]; got ${n}`)
  }
  return `${prefix}${String(n).padStart(ID_WIDTH, '0')}`
}

/**
 * Parse a strict canonical ID. Returns the parsed components on success or
 * `null` on any deviation: unpadded (`H1`), overlong (`H10000`), wrong
 * prefix (`Z0001`), value 0 (`H0000`), trailing whitespace, etc.
 */
export function parseId(s: string): ParsedId | null {
  if (typeof s !== 'string') return null
  const m = ID_REGEX.exec(s)
  if (!m) return null
  const prefix = m[1] as IdPrefix
  const n = parseInt(m[2]!, 10)
  if (n < ID_MIN || n > ID_MAX) return null
  return { prefix, n }
}

/** True iff the input is a canonical ID with the given prefix. */
export function isId(s: unknown, prefix?: IdPrefix): s is string {
  const parsed = parseId(typeof s === 'string' ? s : '')
  if (!parsed) return false
  if (prefix !== undefined && parsed.prefix !== prefix) return false
  return true
}

// ---------------------------------------------------------------------------
// Slugs, Run directories, Experiment folders and Run paths
//
// Every slug / Run / Experiment pattern in memon is defined here. Reference
// checks must never be stricter than discovery: a Run or Experiment that
// discovery accepts today must stay referenceable. Only creating a new
// Experiment slug uses the stricter `SLUG_STRICT_REGEX`.
// ---------------------------------------------------------------------------

/** Slug body shared by Experiment folders, wiki pages and reports. */
export const SLUG_SOURCE = '[a-z0-9][a-z0-9-]*'
/** Any slug discovery accepts (one character, trailing `-` allowed). */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/
/** New Experiment slugs: at least two characters, not ending in `-`. */
export const SLUG_STRICT_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

/** True iff `s` is a slug; `strict` applies the creation rule. */
export function isSlug(s: unknown, opts: { strict?: boolean } = {}): s is string {
  if (typeof s !== 'string') return false
  return (opts.strict === true ? SLUG_STRICT_REGEX : SLUG_REGEX).test(s)
}

/** Run directory base name as discovery identifies it: `<name>-yymmdd-hhmmss`. */
export const RUN_DIR_REGEX = /^.+-\d{6}-\d{6}$/
/** The `-yymmdd-hhmmss` tail of a Run directory name. */
export const RUN_TIMESTAMP_TAIL_REGEX = /-\d{6}-\d{6}$/

/** True iff `s` is a single path segment discovery would identify as a Run. */
export function isRunDirName(s: unknown): s is string {
  return typeof s === 'string' && !s.includes('/') && RUN_DIR_REGEX.test(s)
}

/** Slug part of a Run directory name (everything before the timestamp tail). */
export function runSlugFromDirName(dirName: string): string | null {
  const m = /^(.+)-\d{6}-\d{6}$/.exec(dirName)
  return m ? (m[1] ?? null) : null
}

/**
 * Legacy free-text Run mention token. Prose scanners keep it verbatim so
 * nothing they extracted before changes; see `extractRunMentions` for the
 * whole-token fallback that covers every other discoverable name.
 */
export const RUN_MENTION_SOURCE = '[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\\d{6}-\\d{6}'

/** Experiment folder: `E<NNNN>-<slug>`. Group 1 = digits, group 2 = slug. */
export const EXPERIMENT_DIR_REGEX = /^E(\d{4})-([a-z0-9][a-z0-9-]*)$/
/** Legacy single-file Experiment doc: `E<NNNN>-<slug>.md`. */
export const EXPERIMENT_FILENAME_REGEX = /^E(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/
/**
 * Experiment reference: `E<NNNN>`, optional `-<slug>`, optional `/V<NNNN>`.
 * Group 1 = `E<NNNN>`, group 2 = slug, group 3 = Variant id.
 */
export const EXPERIMENT_REF_REGEX = /^(E\d{4})(?:-([a-z0-9][a-z0-9-]*))?(?:\/(V\d{4}))?$/
/**
 * Free-text Experiment mention. Ends on an alphanumeric so trailing prose
 * dashes are not swallowed; one-character slugs are matched.
 */
export const EXPERIMENT_MENTION_SOURCE = 'E\\d{4}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'

/** Directories under the project root that may contain Run directories. */
export const RUN_ROOT_DIRECTORIES = ['logs', 'outputs', 'experiments'] as const

/**
 * Shape of a project-relative Run path as a reference: a Run root, any
 * directories, and a discoverable Run name. `isRunPath` adds the traversal
 * guards required before the path is resolved on disk.
 */
export const RUN_PATH_SHAPE_REGEX = /^(?:logs|outputs|experiments)\/(?:[^/]+\/)*[^/]+-\d{6}-\d{6}$/

/** A safe project-relative Run path (`logs|outputs|experiments/…/<run>`). */
export function isRunPath(value: string): boolean {
  const parts = value.split('/')
  return (
    parts.length >= 2 &&
    (RUN_ROOT_DIRECTORIES as readonly string[]).includes(parts[0]!) &&
    !/[\\\0]/.test(value) &&
    !/%(?:2f|5c)/i.test(value) &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    RUN_DIR_REGEX.test(parts.at(-1)!)
  )
}

const MENTION_WRAPPERS = /^[\s`'"([{<*_~]+|[\s`'"\])}>*_~.,;:!?]+$/g

/**
 * Run names mentioned in free text. Every match of the legacy token is
 * returned (unchanged behaviour); additionally, a whitespace/comma/semicolon
 * delimited token — stripped of wrapping quotes, brackets and emphasis — that
 * is a discoverable Run name is returned when the legacy token finds nothing
 * inside it. Order follows the text; duplicates are removed.
 */
export function extractRunMentions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    out.push(name)
  }
  const legacy = new RegExp(RUN_MENTION_SOURCE, 'g')
  for (const raw of text.split(/[\s,;]+/)) {
    if (raw === '') continue
    const found = raw.match(legacy)
    if (found) {
      for (const name of found) push(name)
      continue
    }
    const token = raw.replace(MENTION_WRAPPERS, '')
    if (isRunDirName(token)) push(token)
  }
  return out
}
