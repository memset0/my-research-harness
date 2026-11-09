import type { DiscussionDetail } from './dto/discussions'
export interface DiscussionViewState {
  version: 1
  items: Record<string, string>
}
function hash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16)
}
export function discussionViewState(doc: DiscussionDetail): DiscussionViewState {
  const items: Record<string, string> = {
    '@document': hash(
      JSON.stringify([
        doc.title,
        doc.status,
        doc.categories,
        doc.parts.filter((p) => p.type === 'prose'),
      ]),
    ),
  }
  for (const q of doc.questions)
    items[q.metadata?.id ?? `invalid-${q.line}`] = hash(
      JSON.stringify([q.sectionHash, q.displayStatus, q.history.length, q.history.at(-1)]),
    )
  return { version: 1, items }
}
export function parseDiscussionViewState(text: string | null): DiscussionViewState | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return v?.version === 1 &&
      v.items &&
      typeof v.items === 'object' &&
      !Array.isArray(v.items) &&
      Object.keys(v.items).length <= 10000 &&
      Object.values(v.items).every((x) => typeof x === 'string')
      ? v
      : null
  } catch {
    return null
  }
}
export function changedDiscussionItems(
  before: DiscussionViewState | null,
  after: DiscussionViewState,
): string[] {
  return before
    ? Object.keys(after.items).filter((key) => before.items[key] !== after.items[key])
    : []
}
