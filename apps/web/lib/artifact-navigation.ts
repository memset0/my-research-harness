// Canonical full-page destinations for artifact links. Every Experiment,
// Report, wiki and code-review link opens the target's own page; nothing is carried over
// from the page the link was activated on.

import { type ProjectTarget, projectRouteTarget } from './api'
import {
  codeReviewPage,
  experimentPath,
  projectPagePath,
  reportPath,
  wikiPath,
} from './project-routes'

export type ArtifactNavigationTarget =
  | { kind: 'experiment'; id: string }
  | { kind: 'report'; id: string }
  | { kind: 'wiki'; id: string }

export function canonicalExperimentHref(project: ProjectTarget, experimentId: string): string {
  return experimentPath(projectRouteTarget(project), experimentId)
}

export function canonicalReportHref(project: ProjectTarget, reportId: string): string {
  return reportPath(projectRouteTarget(project), reportId)
}

export function canonicalWikiHref(project: ProjectTarget, wikiId: string): string {
  return wikiPath(projectRouteTarget(project), wikiId)
}

/** A code review's page; an id that names no review opens the review list. */
export function canonicalCodeReviewHref(project: ProjectTarget, reviewId: string): string {
  return projectPagePath(
    projectRouteTarget(project),
    codeReviewPage(reviewId) ?? { kind: 'code-reviews' },
  )
}

/** The full page of an artifact link's target. */
export function artifactHref(project: ProjectTarget, target: ArtifactNavigationTarget): string {
  if (target.kind === 'experiment') return canonicalExperimentHref(project, target.id)
  if (target.kind === 'report') return canonicalReportHref(project, target.id)
  return canonicalWikiHref(project, target.id)
}
