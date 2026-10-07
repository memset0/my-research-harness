import { createHash } from 'node:crypto'
import type { ProjectConfig } from '../types.js'

/** Explicit physical-source sharing, otherwise an opaque authority identity. */
export function projectSourceGroup(project: ProjectConfig): string {
  if (project.storageGroup !== undefined) return project.storageGroup
  if (project.access?.source !== undefined) return project.access.source
  if (project.access) {
    return `source-${createHash('sha256')
      .update(
        JSON.stringify([
          project.root,
          project.access.kind,
          project.access.kind === 'agent' ? project.access.sourceIdentity : null,
        ]),
      )
      .digest('hex')
      .slice(0, 24)}`
  }
  return project.host === undefined ? project.name : `${project.host}/${project.name}`
}
