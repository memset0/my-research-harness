import { dirname, join } from 'node:path'
import type { Config } from '@memon/core'

interface ResourceDto {
  project: string
  resource: string
}

function root(config: Config, project: string): string {
  const entry = config.projects.find((candidate) => candidate.name === project)
  if (!entry) throw new Error('Project is not configured')
  return entry.root
}

const absolute = (config: Config, project: string, resource: string) =>
  join(root(config, project), resource)

export function standaloneRun<T extends ResourceDto>(config: Config, run: T) {
  return { ...run, path: dirname(absolute(config, run.project, run.resource)) }
}

/** Adds the absolute bundle path to an Experiment DTO. */
export function standaloneExperiment<T extends ResourceDto>(config: Config, experiment: T) {
  const path = absolute(config, experiment.project, experiment.resource)
  return {
    ...experiment,
    path: experiment.resource.endsWith('/README.md') ? dirname(path) : path,
  }
}

export function standaloneReport<T extends ResourceDto>(config: Config, report: T) {
  return { ...report, path: absolute(config, report.project, report.resource) }
}

export function standaloneCodeReview<T extends ResourceDto>(config: Config, review: T) {
  return { ...review, path: absolute(config, review.project, review.resource) }
}

export function standaloneReadme<T extends ResourceDto>(config: Config, readme: T) {
  return { ...readme, path: absolute(config, readme.project, readme.resource) }
}
