import type { DiscussionDocument, discussionCitations, listDiscussions } from '@memon/core'
export interface DiscussionComparison {
  before: string
  after: string
  source: 'git' | 'snapshot' | 'unavailable'
  truncated: boolean
}
export type DiscussionDetail = DiscussionDocument & {
  comparisons?: Record<string, DiscussionComparison>
}
export type DiscussionCitationsResponse = Awaited<ReturnType<typeof discussionCitations>>
export interface DiscussionsResponse {
  discussions: Awaited<ReturnType<typeof listDiscussions>>
}
