import { isMap, isSeq, parseDocument } from 'yaml'
import { derivePayload } from '../../payload'
import { BlockRewriteError, locateComponentBlock, replaceBlockPayload, type BlockTarget } from '../../rewrite'
import { validatePayload } from '../../registry'
import { CHECKLIST_STATUS_FIELDS, type ChecklistStatusField } from './index'

export interface ChecklistStatusEdit {
  target: BlockTarget
  payload: string
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
  if (!CHECKLIST_STATUS_FIELDS.includes(edit.field)) throw new ChecklistEditError(`unknown status field ${edit.field}`)
  const block = locateComponentBlock(document, edit.target)
  // Verify identity before parsing/editing so stale callers receive the one
  // actionable error even if their old payload no longer has the requested item.
  try {
    replaceBlockPayload(document, edit.target, edit.payload, edit.payload)
  } catch (cause) {
    if (cause instanceof BlockRewriteError) throw new ChecklistEditError(cause.message)
    throw cause
  }
  const info = block.info.trim().split(/\s+/)[1] ?? ''
  if (!/^checklist(?:@1)?$/.test(info)) throw new ChecklistEditError(`block at line ${block.line} is not checklist@1`)
  const derived = derivePayload('yaml', edit.payload)
  if (derived.kind !== 'static') throw new ChecklistEditError(derived.kind === 'error' ? derived.message : 'executable checklists are read-only')
  const validation = validatePayload('checklist', 1, derived.value)
  if (!validation.ok) throw new ChecklistEditError(validation.message)

  const yaml = parseDocument(edit.payload, { schema: 'core', uniqueKeys: true })
  const keyPath: (string | number)[] = ['items']
  edit.path.forEach((index, depth) => {
    if (depth > 0) keyPath.push('children')
    keyPath.push(index)
  })
  const item = yaml.getIn(keyPath)
  const parent = yaml.getIn(keyPath.slice(0, -1))
  if (!isMap(item) || !isSeq(parent)) throw new ChecklistEditError(`no checklist item at ${edit.path.join('.')}`)
  yaml.setIn([...keyPath, 'status', edit.field], edit.value)
  const nextPayload = yaml.toString({ lineWidth: 0 }).replace(/\n$/, '')
  try {
    return replaceBlockPayload(document, edit.target, edit.payload, nextPayload)
  } catch (cause) {
    if (cause instanceof BlockRewriteError) throw new ChecklistEditError(cause.message)
    throw cause
  }
}
