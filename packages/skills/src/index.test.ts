import { readFileSync, readdirSync, statSync } from 'node:fs'
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

describe('retired-skills.json', () => {
  const registry = JSON.parse(readFileSync(join(packageRoot, 'retired-skills.json'), 'utf8'))
  const entries: { name: string; deposit_digests: string[] }[] = registry.retired

  it('never lists a name the bundle still ships', () => {
    // A shipped name in the registry would let `install-skills` treat a live
    // skill as retirable.
    for (const entry of entries) {
      expect(SKILL_NAMES).not.toContain(entry.name)
      expect(bundledDirs).not.toContain(entry.name)
    }
  })

  it('gives every retired name at least one full-length sha256 deposit', () => {
    // An empty or malformed digest list matches nothing, so a stale managed
    // copy would silently survive every future install.
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.deposit_digests.length).toBeGreaterThan(0)
      for (const digest of entry.deposit_digests) {
        expect(digest).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('covers the skills this harness retired', () => {
    const names = entries.map((e) => e.name)
    expect(names).toContain('memon-append-journal')
    expect(names).toContain('memon-digest-journal')
    expect(names).toContain('memon-author-components')
  })
})

describe('harness repository', () => {
  // Bundled skills have one source, this package, and reach research projects
  // through `memon install-skills`. A copy in the harness's own agent skill
  // directories goes stale and shadows the package for harness developers.
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

  it('carries no memon skill copies in its agent skill directories', () => {
    const strays: string[] = []
    for (const dir of ['.claude/skills', '.codex/skills', '.opencode/skills']) {
      let entries: string[]
      try {
        entries = readdirSync(join(repoRoot, dir))
      } catch {
        continue
      }
      for (const name of entries) {
        if (name.startsWith('memon-') || name === 'PREFLIGHT.md') strays.push(`${dir}/${name}`)
      }
    }
    expect(strays).toEqual([])
  })
})
