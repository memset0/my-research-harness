import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const guide = readFileSync(new URL('../../migrations/v9-to-v10.md', import.meta.url), 'utf8')
describe('FS10 migration guide contract', () => {
  it('provides the seven sections and fixed rollback commit contract', () => {
    expect(guide.match(/^## .+$/gm)).toEqual([
      '## Background / Why',
      '## Detection',
      '## Diff (v9 → v10)',
      '## Target State (v10 Summary)',
      '## Verification',
      '## Rollback Notes',
      '## Edge Cases',
    ])
    const rollback = guide.split('## Rollback Notes')[1]!.split('## Edge Cases')[0]!
    expect(rollback).toContain('chore(memon): migrate FS convention v9 -> v10')
    expect(rollback).toContain('git -C "$PROJECT_ROOT" revert')
    expect(rollback).toContain('tar -xzf')
  })
  it('uses executable detection and fail-closed verification without extra runtimes', () => {
    const detection = guide.split('## Detection')[1]!.split('## Diff')[0]!
    for (const line of detection.split('\n').filter((line) => line.startsWith('- '))) {
      expect(line).toMatch(/^- `[^`]+`/)
    }
    const verification = guide.split('## Verification')[1]!.split('## Rollback Notes')[0]!
    const shell = /```bash\n([\s\S]*?)```/.exec(verification)![1]!
    expect(shell).not.toMatch(/\b(node|python3?|yq|xmllint)\b/)
    expect(shell).toContain('jq -e')
    expect(shell).toContain('&& echo OK')
  })
  it('addresses preservation, approval and the four migration edge cases', () => {
    for (const label of [
      'Missing required file',
      'User-added custom frontmatter fields',
      'User mid-edit (dirty worktree)',
      'Concurrent migration',
    ]) {
      expect(guide).toContain(`**${label}:**`)
    }
    expect(guide).toContain('installing it never runs this migration')
    expect(guide).toContain('does not infer historical scientific boundaries')
    expect(guide).toContain('No Run README, result.csv, Wiki or project.yml is')
    expect(guide).not.toMatch(/\b(might|consider|you could)\b/i)
  })
})
