// Response DTOs: Project and Host listings (`/api/projects`, `/api/hosts`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { HostAvailability, ProjectRef } from '@memon/core'

export interface StandaloneProjectSummary {
  mode: 'standalone'
  host: null
  project: string
  name: string
  root: string
  exclude: string[]
}

export type CentralProjectSummary = ProjectRef & {
  mode: 'central'
  name: string
  label?: string
  description?: string
  root?: never
  exclude?: never
}

export type ProjectSummary = StandaloneProjectSummary | CentralProjectSummary

export interface HostsResponse {
  hosts: Array<HostAvailability & { label?: string }>
}

export interface ProjectsResponse {
  projects: ProjectSummary[]
}
