import 'server-only'

import { ProjectRefSchema } from '@memon/core'

export function centralProjectTitle(input: unknown): {
  default: string
  template: string
} | null {
  const project = ProjectRefSchema.safeParse(input)
  if (!project.success) return null
  const identity = `${project.data.host}/${project.data.project}`
  return { default: identity, template: `%s · ${identity} · memon` }
}

export function applyCentralProjectTitle(template: string, childTitle: string): string {
  return template.replace('%s', childTitle)
}
