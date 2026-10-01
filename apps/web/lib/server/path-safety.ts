// Reject API path parameters that escape any configured project root.
//
// Without this, a request like `?path=/etc/passwd` would let the web layer
// read arbitrary files. Every endpoint that accepts a `path` query parameter
// MUST go through `assertWithinProjectRoots()` before touching the filesystem.

import 'server-only'

import { resolve } from 'node:path'
import type { Config } from '@memon/core'

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathSafetyError'
  }
}

export function assertWithinProjectRoots(absoluteOrRelative: string, config: Config): string {
  const normalized = resolve(absoluteOrRelative)
  for (const p of config.projects) {
    const root = resolve(p.root)
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      return normalized
    }
  }
  throw new PathSafetyError(`path "${absoluteOrRelative}" is outside any configured project root`)
}
