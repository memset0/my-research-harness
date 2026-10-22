// Canonical full-page destinations for artifact links. Every Experiment,
// Report and wiki link opens the target's own page; nothing is carried over
// from the page the link was activated on.

import { type ProjectTarget, projectWebPath } from './api'

export type ArtifactNavigationTarget =
  | { kind: 'experiment'; id: string }
  | { kind: 'report'; id: string }
  | { kind: 'wiki'; id: string }

const EXPERIMENT_ID_RE = /^E\d{4}(?:-[^/?#]+)?$/u
const REPORT_ID_RE = /^R\d{4}$/
const WIKI_ID_RE = /^W\d{4}$/

function assertId(re: RegExp, id: string, label: string): void {
  if (id.includes('\0') || !re.test(id)) throw new TypeError(`Invalid ${label} ID: ${id}`)
}

export function canonicalExperimentHref(project: ProjectTarget, experimentId: string): string {
  assertId(EXPERIMENT_ID_RE, experimentId, 'Experiment')
  return projectWebPath(project, `/e/${encodeURIComponent(experimentId)}`)
}

export function canonicalReportHref(project: ProjectTarget, reportId: string): string {
  assertId(REPORT_ID_RE, reportId, 'Report')
  return projectWebPath(project, `/reports/${encodeURIComponent(reportId)}`)
}

export function canonicalWikiHref(project: ProjectTarget, wikiId: string): string {
  assertId(WIKI_ID_RE, wikiId, 'wiki page')
  return projectWebPath(project, `/wiki/${encodeURIComponent(wikiId)}`)
}

/** The full page of an artifact link's target. */
export function artifactHref(project: ProjectTarget, target: ArtifactNavigationTarget): string {
  if (target.kind === 'experiment') return canonicalExperimentHref(project, target.id)
  if (target.kind === 'report') return canonicalReportHref(project, target.id)
  return canonicalWikiHref(project, target.id)
}
