// Surgical Run frontmatter edits.
//
// Some mutations must not reshape the document they touch: flipping
// `deprecated` on a run is bookkeeping, so the body — legacy narrative
// chapters, hand-written notes, unknown headings — has to come back byte for
// byte. Re-serializing through the section serializer cannot promise that.
//
// YAML source ranges identify the actual top-level keys, including quoted
// keys and flow mappings. Only changed ranges are replaced; the surrounding
// source and the entire body are copied without reformatting.

import { isMap, isNode, isScalar, parseDocument } from 'yaml'

/** Keys this module knows how to write. */
export type PatchableRunFrontMatterKey =
  | 'id'
  | 'name'
  | 'project'
  | 'experiment'
  | 'created_at'
  | 'host'
  | 'pid'
  | 'gpus'
  | 'entry'
  | 'command'
  | 'wandb'
  | 'hypotheses'
  | 'tags'
  | 'status'
  | 'archived'
  | 'deprecated'
  | 'updated_at'
  | 'finished_at'

/**
 * Value semantics:
 *   - `string`  → written as-is (already YAML-safe: timestamps, enums)
 *   - `boolean` → written as `true` / `false`
 *   - `null`    → the key is REMOVED when present (canonical "absent means
 *                 default", used by undeprecate so a restored run is
 *                 byte-identical to its pre-deprecation state)
 */
export type RunFrontMatterPatch = Partial<
  Record<PatchableRunFrontMatterKey, string | boolean | null>
>

export class RunFrontMatterPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunFrontMatterPatchError'
  }
}

/**
 * Apply `patch` to the frontmatter block of `content`, leaving the body and
 * all untouched keys exactly as they were. Throws when the document has no
 * frontmatter block (callers should treat that as a malformed Run README
 * rather than silently inventing one).
 */
export function patchRunFrontMatter(content: string, patch: RunFrontMatterPatch): string {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return content
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content)
  if (!opening)
    throw new RunFrontMatterPatchError('README.md has no YAML frontmatter block to patch')
  const closing = /^(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/gm
  closing.lastIndex = opening[0].length
  const close = closing.exec(content)
  if (!close) throw new RunFrontMatterPatchError('README.md frontmatter block is not terminated')
  const source = content.slice(opening[0].length, close.index)
  const document = parseDocument(source)
  if (document.errors.length > 0 || (document.contents && !isMap(document.contents))) {
    throw new RunFrontMatterPatchError('README.md frontmatter must be a valid YAML mapping')
  }
  const mapping = isMap(document.contents) ? document.contents : null
  const pairs = mapping?.items ?? []
  const edits: Array<{ start: number; end: number; text: string }> = []
  const additions: string[] = []
  for (const [key, value] of entries) {
    const index = pairs.findIndex((pair) => isScalar(pair.key) && pair.key.value === key)
    if (index === -1) {
      if (value !== null) additions.push(`${key}: ${String(value)}`)
      continue
    }
    const pair = pairs[index]!
    const keyRange = nodeRange(pair.key)
    const valueRange = nodeRange(pair.value)
    if (!keyRange || !valueRange) {
      throw new RunFrontMatterPatchError(`Cannot locate frontmatter field ${key}`)
    }
    if (value !== null) {
      const before = source[valueRange[0] - 1] === ':' ? ' ' : ''
      const after = valueRange[0] === valueRange[1] && source[valueRange[1]] === '#' ? ' ' : ''
      edits.push({ start: valueRange[0], end: valueRange[1], text: before + String(value) + after })
    } else if (mapping?.flow) {
      const mapRange = mapping.range!
      const next = pairs[index + 1]
      const previous = pairs[index - 1]
      edits.push({
        start:
          pairs.length === 1
            ? mapRange[0] + 1
            : next
              ? keyRange[0]
              : nodeRange(previous!.value)![1],
        end: pairs.length === 1 ? mapRange[1] - 1 : next ? nodeRange(next.key)![0] : valueRange[1],
        text: '',
      })
    } else {
      edits.push({
        start: source.lastIndexOf('\n', keyRange[0] - 1) + 1,
        end: valueRange[2],
        text: '',
      })
    }
  }
  if (additions.length > 0) {
    const newline = opening[0].endsWith('\r\n') ? '\r\n' : '\n'
    const at = mapping?.flow
      ? pairs.length > 0
        ? nodeRange(pairs[0]!.key)![0]
        : mapping.range![0] + 1
      : source.length
    const text = mapping?.flow
      ? additions.join(', ') + (pairs.length > 0 ? ', ' : '')
      : (source !== '' && !source.endsWith('\n') ? newline : '') + additions.join(newline) + newline
    edits.push({ start: at, end: at, text })
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: typeof edits = []
  for (const edit of edits) {
    const previous = merged.at(-1)
    if (previous && previous.text === '' && edit.text === '' && edit.start <= previous.end) {
      previous.end = Math.max(previous.end, edit.end)
    } else {
      merged.push(edit)
    }
  }
  let result = source
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const edit = merged[index]!
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }
  return opening[0] + result + content.slice(close.index)
}

function nodeRange(node: unknown) {
  return isNode(node) ? node.range : undefined
}
