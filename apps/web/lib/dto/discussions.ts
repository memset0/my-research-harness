import type { DiscussionDocument, listDiscussions } from '@memon/core'
export interface DiscussionComparison {
  before: string
  after: string
  source: 'git' | 'snapshot' | 'unavailable'
  truncated: boolean
}
export type DiscussionDetail = DiscussionDocument & {
  comparisons?: Record<string, DiscussionComparison>
}
export interface DiscussionsResponse {
  discussions: Awaited<ReturnType<typeof listDiscussions>>
}
