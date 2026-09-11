/**
 * Rewrites one status flag of one `checklist@1` item inside a Markdown
 * document, leaving every other byte alone.
 *
 * The block is addressed by the 1-based line of its opening fence in the full
 * document plus the payload the caller rendered; a mismatch means the caller
 * is looking at a stale snapshot and the write is refused rather than applied
 * to whatever happens to be on that line now.
 */

import { isMap, isSeq, parseDocument } from 'yaml'
import { scanFencedBlocks } from '../fence'
import { parseWikiComponentInfoString } from '../parse-info-string'
import { type ChecklistStatusField, CHECKLIST_STATUS_FIELDS, loadChecklistYaml } from './index'

export interface ChecklistStatusEdit {
  /** 1-based line of the block's opening fence in `document`. */
  line: number
  /** Payload the caller rendered; must match the block on disk verbatim. */
  payload: string
  /** Item position: `[0]` is the first root item, `[0, 2]` its third child. */
  path: readonly number[]
  field: ChecklistStatusField
  value: boolean
}

export class ChecklistEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistEditError'
  }
}

export function setChecklistStatus(document: string, edit: ChecklistStatusEdit): string {
  if (edit.path.length === 0) throw new ChecklistEditError('item path is empty')
  if (!CHECKLIST_STATUS_FIELDS.includes(edit.field)) {
    throw new ChecklistEditError(`unknown status field ${edit.field}`)
  }
  const newline = document.includes('\r\n') ? '\r\n' : '\n'
  const lines = document.split('\n')
  const block = scanFencedBlocks(document).find((candidate) => candidate.line === edit.line)
  if (!block) throw new ChecklistEditError(`no fenced block opens at line ${edit.line}`)
  const info = parseWikiComponentInfoString(block.info)
  if (!info || info.name !== 'checklist') {
    throw new ChecklistEditError(`block at line ${edit.line} is not a checklist component`)
  }
  if (block.payload.replace(/\r(?=\n|$)/g, '') !== edit.payload.replace(/\r(?=\n|$)/g, '')) {
    throw new ChecklistEditError('checklist block changed since it was rendered')
  }
  if (block.closeIndex >= lines.length) {
    throw new ChecklistEditError('checklist block is not closed')
  }
  // Validates structure (and rejects aliases) before the positional edit.
  loadChecklistYaml(block.payload)

  const yamlDocument = parseDocument(block.payload, { schema: 'core', uniqueKeys: true })
  const keyPath: (string | number)[] = ['items']
  edit.path.forEach((index, depth) => {
    if (depth > 0) keyPath.push('children')
    keyPath.push(index)
  })
  const item = yamlDocument.getIn(keyPath)
  if (!isMap(item)) throw new ChecklistEditError(`no checklist item at ${edit.path.join('.')}`)
  const parent = yamlDocument.getIn(keyPath.slice(0, -1))
  if (!isSeq(parent)) throw new ChecklistEditError(`no checklist item at ${edit.path.join('.')}`)
  yamlDocument.setIn([...keyPath, 'status', edit.field], edit.value)

  const rewritten = yamlDocument.toString({ lineWidth: 0 }).replace(/\n$/, '')
  const payloadLines = rewritten.split('\n').map((content) => (content.length > 0 ? block.indent + content : content))
  const next = [
    ...lines.slice(0, block.openIndex + 1),
    ...payloadLines.map((content) => (newline === '\r\n' ? `${content}\r` : content)),
    ...lines.slice(block.closeIndex),
  ]
  return next.join('\n')
}
