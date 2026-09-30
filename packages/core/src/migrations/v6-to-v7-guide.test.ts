// The v6-to-v7 guide is the migrate-fs runtime's only contract, so hold it to
// `openspec/specs/fs-migration-guide-authoring/spec.md` mechanically.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const guide = readFileSync(new URL('../../migrations/v6-to-v7.md', import.meta.url), 'utf8')

function section(heading: string): string {
  const start = guide.indexOf(`\n## ${heading}\n`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = guide.slice(start + heading.length + 5)
  const end = rest.search(/\n## /)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('v6-to-v7 migration guide', () => {
  it('has exactly the seven required H2 headings in order', () => {
    expect(guide.match(/^## .+$/gm)).toEqual([
      '## Background / Why',
      '## Detection',
      '## Diff (v6 → v7)',
      '## Target State (v7 Summary)',
      '## Verification',
      '## Rollback Notes',
      '## Edge Cases',
    ])
  })

  it('declares the migration mechanical', () => {
    expect(section('Background / Why')).toMatch(/\*\*mechanical\*\*/)
  })

  it('uses literal commands for every Detection bullet', () => {
    const bullets = section('Detection')
      .split('\n')
      .filter((line) => line.startsWith('- '))
    expect(bullets.length).toBeGreaterThan(0)
    for (const bullet of bullets) expect(bullet).toMatch(/^- `[^`]+`/)
  })

  it('verifies with one bash block using only allowed tools, printing OK', () => {
    const verification = section('Verification')
    const blocks = [...verification.matchAll(/```(\w+)\n([\s\S]*?)```/g)]
    expect(blocks).toHaveLength(1)
    expect(blocks[0]![1]).toBe('bash')
    const commands = blocks[0]![2]!.split('\n').filter((line) => line && !line.startsWith('#'))
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command).toMatch(/&& echo OK$/)
      expect(command).not.toMatch(/\b(node|python3?|yq|xmllint|sed|awk|perl)\b/)
    }
  })

  it('carries the fixed commit message in Rollback Notes only', () => {
    const message = 'chore(memon): migrate FS convention v6 -> v7'
    expect(section('Rollback Notes')).toContain(message)
    expect(section('Verification')).not.toContain(message)
    expect(section('Rollback Notes')).toMatch(/git -C "\$PROJECT_ROOT" revert/)
    expect(section('Rollback Notes')).toMatch(/tar -xzf/)
  })

  it('addresses the four canonical edge cases', () => {
    const edges = section('Edge Cases')
    for (const label of [
      '**Missing required file:**',
      '**User-added custom frontmatter fields:**',
      '**User mid-edit (dirty worktree):**',
      '**Concurrent migration:**',
    ])
      expect(edges).toContain(label)
  })

  it('uses no hedging language', () => {
    expect(guide).not.toMatch(/\b(might|consider|you could)\b/i)
  })
})
