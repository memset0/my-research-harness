import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SKILL_NAMES } from './index.js'

// `SKILLS_DIR` is computed relative to the compiled `dist/index.js`; under
// vitest we run from `src/`, so resolve the package root from this file.
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const bundledDirs = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('memon-'))
  .map((entry) => entry.name)
  .sort()

describe('SKILL_NAMES', () => {
  it('matches the bundled memon-* directories exactly', () => {
    // `install-skills` copies every `memon-*` directory; consumers enumerate
    // SKILL_NAMES. A directory missing from the tuple (or a tuple entry with
    // no directory) means the two views of the bundle disagree.
    expect([...SKILL_NAMES].sort()).toEqual(bundledDirs)
  })

  it('has no duplicate entries', () => {
    expect(new Set(SKILL_NAMES).size).toBe(SKILL_NAMES.length)
  })

  it('gives every bundled skill a SKILL.md', () => {
    for (const name of SKILL_NAMES) {
      expect(statSync(join(packageRoot, name, 'SKILL.md')).isFile()).toBe(true)
    }
  })
})
