import yaml from 'js-yaml'
import { splitFrontmatter } from './frontmatter.js'

/** Presentation and maintenance metadata shared by Wiki and Reports. */
export interface ContentFields {
  description?: string | null
  presentation?: 'markdown' | 'html' | 'service'
  category?: string
  freshness?: 'CURRENT' | 'STALE'
  staleReason?: string
  asOf?: string
  sourceCommits?: Record<string, string>
  createdAt?: string
  updatedAt?: string
  servicePort?: number
  contentEntry?: string
  contentError?: string
}

export interface ParsedContent {
  metadata: Record<string, unknown>
  body: string
  fields: ContentFields
  errors: string[]
  manifest: boolean
}

const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** Reject encoded traversal as well as URL/absolute paths. */
export function validContentEntry(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048) return false
  let decoded = value
  for (let pass = 0; pass < 3; pass++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      return false
    }
  }
  return (
    !/[\\\0?#:%]/.test(decoded) &&
    !decoded.startsWith('/') &&
    decoded
      .split('/')
      .every(
        (part, index) => part !== '..' && (part !== '' || index === decoded.split('/').length - 1),
      )
  )
}

/** Raw JSON stays raw JSON: callers use the source bytes for locking and editing. */
export function parseContent(
  content: string,
  path: string,
  fallbackCategory?: string,
): ParsedContent {
  const manifest = path.endsWith('/manifest.json') || path === 'manifest.json'
  const errors: string[] = []
  let metadata: Record<string, unknown> = {}
  let body = content
  try {
    let value: unknown
    if (manifest) {
      value = JSON.parse(content)
      body = ''
    } else {
      const split = splitFrontmatter(content)
      if (split.status === 'ok') {
        value = yaml.load(split.raw, { schema: yaml.JSON_SCHEMA })
        body = split.body
      }
    }
    if (value !== undefined && value !== null) {
      if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('metadata must be an object')
      metadata = value as Record<string, unknown>
    }
  } catch (error) {
    errors.push((error as Error).message)
  }
  const fields: ContentFields = { presentation: 'markdown' }
  const stringField = (key: string, target: keyof ContentFields, max = 4096) => {
    const value = metadata[key]
    if (value === undefined) return
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      errors.push(`${key} must be a non-empty string`)
    else Object.assign(fields, { [target]: value })
  }
  stringField('description', 'description')
  stringField('category', 'category', 128)
  if (!fields.category && fallbackCategory) fields.category = fallbackCategory
  stringField('stale_reason', 'staleReason')
  for (const [key, target] of [
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
    ['as_of', 'asOf'],
  ] as const) {
    if (metadata[key] === undefined) continue
    const value = metadata[key]
    if (typeof value !== 'string' || !timestamp.test(value) || !Number.isFinite(Date.parse(value)))
      errors.push(`${key} must be an ISO8601 timestamp with an offset`)
    else fields[target] = value
  }
  if (metadata.freshness !== undefined) {
    if (metadata.freshness !== 'CURRENT' && metadata.freshness !== 'STALE')
      errors.push('freshness must be CURRENT or STALE')
    else fields.freshness = metadata.freshness
  }
  if (metadata.source_commits !== undefined) {
    const commits = metadata.source_commits
    if (
      !commits ||
      typeof commits !== 'object' ||
      Array.isArray(commits) ||
      Object.entries(commits).some(
        ([key, value]) => !key || typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value),
      )
    )
      errors.push('source_commits must map repository names to full commit hashes')
    else fields.sourceCommits = commits as Record<string, string>
  }
  if (manifest) {
    if (typeof metadata.title !== 'string' || !metadata.title.trim() || metadata.title.length > 512)
      errors.push('manifest title is required')
    if (metadata.type !== 'html' && metadata.type !== 'service')
      errors.push('manifest type must be html or service')
    else fields.presentation = metadata.type
    const entry = metadata.entry ?? (metadata.type === 'service' ? './' : 'index.html')
    if (!validContentEntry(entry)) errors.push('entry must be a contained relative path')
    else fields.contentEntry = entry
    if (metadata.type === 'service') {
      if (
        !Number.isInteger(metadata.port) ||
        (metadata.port as number) < 1 ||
        (metadata.port as number) > 65535
      )
        errors.push('service port must be an integer from 1 to 65535')
      else fields.servicePort = metadata.port as number
    }
  } else if (metadata.entry !== undefined) {
    if (!validContentEntry(metadata.entry)) errors.push('entry must be a contained relative path')
    else {
      fields.presentation = 'html'
      fields.contentEntry = metadata.entry
    }
  }
  if (errors.length) {
    fields.contentError = errors.join('; ')
    delete fields.servicePort
  }
  return { metadata, body, fields, errors, manifest }
}
