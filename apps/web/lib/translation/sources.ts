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
      if (Array.isArray(item[key])) item[key].forEach((text: unknown) => add(text))
    }
    if (Array.isArray(item.children)) item.children.forEach(visit)
  }
  for (const key of ['implementation', 'investigation']) {
    const items = record(record(documents[key]).data).items
    if (managed.has(key) && Array.isArray(items)) items.forEach(visit)
  }
  if (managed.has('results')) {
    const results = record(record(documents.results).data)
    for (const annotation of Object.values(record(results.columnAnnotations))) {
      add(record(annotation).description)
      Object.values(record(record(annotation).valueDescriptions)).forEach((text) => add(text))
    }
    if (Array.isArray(results.variants))
      for (const variant of results.variants) {
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
