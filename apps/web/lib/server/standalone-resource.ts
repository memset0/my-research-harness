import 'server-only'

import { relative, sep } from 'node:path'
import { type Config, ResourceIdSchema } from '@memon/core'
import { assertWithinProjectRoots } from './path-safety'

export function standaloneResource(config: Config, absolutePath: string) {
  const safePath = assertWithinProjectRoots(absolutePath, config)
  const project = config.projects.find(
    (candidate) => safePath === candidate.root || safePath.startsWith(`${candidate.root}${sep}`),
  )
  if (!project) throw new Error('Project resource is not configured')
  const resource = ResourceIdSchema.parse(relative(project.root, safePath).split(sep).join('/'))
  return { project, resource, safePath }
}
