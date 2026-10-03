import { splitFrontmatter } from '../frontmatter'

export type TranslationKind = 'experiment' | 'wiki' | 'report'
export interface TranslationDocument {
  host?: string
  project: string
  kind: TranslationKind
  id: string
}
export interface TranslationSource {
  format: 'markdown' | 'literal'
  text: string
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

export function translationSources(kind: TranslationKind, value: unknown): TranslationSource[] {
  const data = record(value)
  const sources: TranslationSource[] = []
  const add = (text: unknown, format: TranslationSource['format'] = 'markdown') => {
    if (typeof text === 'string' && text.trim()) sources.push({ format, text })
  }
  if (kind !== 'experiment') {
    if (typeof data.content === 'string') add(splitFrontmatter(data.content).body)
    return sources
  }
  const sections = Array.isArray(data.documentSections) ? data.documentSections : []
  const managed = new Set<string>()
  for (const raw of sections) {
    const section = record(raw)
    add(section.heading, 'literal')
    if (section.source === 'yaml') managed.add(String(section.heading).toLowerCase())
    else if (section.source === 'readme') add(section.body)
  }
  const documents = record(data.documents)
  const visit = (raw: unknown) => {
    const item = record(raw)
    add(item.title, 'literal')
    for (const key of ['description', 'question', 'rationale', 'outcome']) add(item[key])
    for (const key of ['acceptanceCriteria', 'successCriteria']) {
      if (Array.isArray(item[key])) for (const text of item[key] as unknown[]) add(text)
    }
    if (Array.isArray(item.children)) item.children.forEach(visit)
  }
  for (const key of ['implementation', 'investigation']) {
    const items = record(record(documents[key]).data).items
    if (managed.has(key) && Array.isArray(items)) items.forEach(visit)
  }
  if (managed.has('results')) {
    // FS v9: the generated Results summary (column annotations, Variant names).
    const summary = record(record(documents.results).summary)
    if (Array.isArray(summary.columns))
      for (const column of summary.columns) {
        add(record(column).description)
        for (const text of Object.values(record(record(column).valueDescriptions))) add(text)
      }
    if (Array.isArray(summary.variants))
      for (const variant of summary.variants) {
        add(record(variant).name, 'literal')
      }
  }
  return sources
}

export async function sourceRevision(sources: TranslationSource[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(sources)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
