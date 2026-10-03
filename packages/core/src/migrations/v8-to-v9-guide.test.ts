// The v8-to-v9 guide is the migrate-fs runtime's only contract, so hold it to
// `openspec/specs/fs-migration-guide-authoring/spec.md` mechanically, plus the
// `fs-migration-runtime` requirements of the Results migration: allow rules
// for ignored result files, fail-closed `git check-ignore` verification and
// the v9-specific edge cases.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RESULT_ALLOW_RULES_COMMENT } from '../results/ignore.js'
import { V8_TO_V9_COMMIT_MESSAGE } from './v8-to-v9.js'

const guide = readFileSync(new URL('../../migrations/v8-to-v9.md', import.meta.url), 'utf8')

function section(heading: string): string {
  const start = guide.indexOf(`\n## ${heading}\n`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = guide.slice(start + heading.length + 5)
  const end = rest.search(/\n## /)
  return end === -1 ? rest : rest.slice(0, end)
}

const flat = (text: string) => text.replace(/\s+/g, ' ')

/** The fenced blocks of a section: `[label, body]`. */
function blocks(text: string): Array<[string, string]> {
  return [...text.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((match) => [match[1]!, match[2]!])
}

/** The Diff subsection of one file (`### \`<file>\` ...` up to the next `###`). */
function diffEntry(file: string): string {
  const diff = section('Diff (v8 → v9)')
  const start = diff.indexOf(`### \`${file}\``)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = diff.slice(start + 4)
  const end = rest.search(/\n### /)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('v8-to-v9 migration guide', () => {
  it('has exactly the seven required H2 headings in order', () => {
    expect(guide.match(/^## .+$/gm)).toEqual([
      '## Background / Why',
      '## Detection',
      '## Diff (v8 → v9)',
      '## Target State (v9 Summary)',
      '## Verification',
      '## Rollback Notes',
      '## Edge Cases',
    ])
  })

  it('declares the migration mechanical and names its change and executor', () => {
    const background = flat(section('Background / Why'))
    expect(background).toMatch(/\*\*mechanical\*\*/)
    expect(background).toContain('`run-results-v9`')
    expect(background).toContain('scripts/migrate-v8-to-v9.mjs')
    expect(background).toMatch(/never creates, edits or deletes `\.memon\/project\.yml`/)
  })

  it('uses literal commands for every Detection bullet', () => {
    const bullets = section('Detection')
      .split('\n')
      .filter((line) => line.startsWith('- '))
    expect(bullets.length).toBeGreaterThan(0)
    for (const bullet of bullets) expect(bullet).toMatch(/^- `[^`]+`/)
    expect(section('Detection')).toContain('fs_convention_version')
  })

  it('shows before/after blocks for every touched file kind, including an allow rule', () => {
    expect(
      blocks(diffEntry('docs/experiments/E<NNNN>-<slug>/results.yaml')).map(([l]) => l),
    ).toEqual(['before'])
    const description = blocks(diffEntry('docs/experiments/E<NNNN>-<slug>/experiment.json'))
    expect(description.map(([label]) => label)).toEqual(['after'])
    expect(description[0]![1]).toContain('"experiment_schema_version": 1')
    expect(description[0]![1]).toContain('"frozen"')
    const result = blocks(diffEntry('logs/a-260901-090000/result.csv'))
    expect(result.map(([label]) => label)).toEqual(['after'])
    expect(result[0]![1].split('\n').slice(0, 2)).toEqual([
      'path,stat,value',
      '$experiment_schema_version,,1',
    ])
    const readme = blocks(diffEntry('docs/experiments/E<NNNN>-<slug>/README.md'))
    expect(readme.map(([label]) => label)).toEqual(['before', 'after'])
    expect(readme[0]![1]).toContain('[results.yaml](./results.yaml)')
    expect(readme[1]![1]).toContain('[experiment.json](./experiment.json)')
    const ignore = blocks(diffEntry('.gitignore'))
    expect(ignore.map(([label]) => label)).toEqual(['before', 'after'])
    expect(ignore[1]![1].startsWith(ignore[0]![1])).toBe(true)
    expect(ignore[1]![1]).toContain(`${RESULT_ALLOW_RULES_COMMENT}\n!/logs/*/result.csv\n`)
    const marker = blocks(diffEntry('.memon/version.json'))
    expect(marker[0]![1]).toContain('"fs_convention_version": 8')
    expect(marker[1]![1]).toContain('"fs_convention_version": 9')
  })

  it('verifies with one bash block using only allowed tools, printing OK', () => {
    const verification = section('Verification')
    const found = blocks(verification)
    expect(found).toHaveLength(1)
    expect(found[0]![0]).toBe('bash')
    const commands = found[0]![1].split('\n').filter((line) => line && !line.startsWith('#'))
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command).toMatch(/&& echo OK$/)
      expect(command).not.toMatch(/\b(node|python3?|yq|xmllint|sed|awk|perl)\b/)
    }
  })

  it('verifies fail-closed with git check-ignore, the summaries and the v2 index', () => {
    const verification = section('Verification')
    expect(verification).toContain('git -C "$PROJECT_ROOT" check-ignore --no-index --stdin')
    expect(verification).toContain('test "$STATUS" = "0 0 0 1"')
    // Symlinked Run paths are probed at their real path (check-ignore rejects a symlink).
    expect(verification).toContain('realpath -e -- "$PROJECT_ROOT/$RUN"')
    expect(verification).toContain('OUTSIDE_PROJECT')
    expect(verification).toContain('experiment results rebuild --all')
    expect(verification).toContain('.snapshot.indexVersion == 2')
    expect(verification).toContain('memon index status --verify --strict')
    expect(verification).toContain('docs/experiments/E[0-9][0-9][0-9][0-9]-*/results.yaml')
  })

  it('carries the fixed commit message in Rollback Notes only, with the allow-rule removal', () => {
    expect(V8_TO_V9_COMMIT_MESSAGE).toBe('chore(memon): migrate FS convention v8 -> v9')
    const rollback = flat(section('Rollback Notes'))
    expect(rollback).toContain(V8_TO_V9_COMMIT_MESSAGE)
    expect(section('Verification')).not.toContain(V8_TO_V9_COMMIT_MESSAGE)
    expect(rollback).toMatch(/git -C "\$PROJECT_ROOT" revert/)
    expect(rollback).toMatch(/tar -xzf/)
    expect(rollback).toMatch(/removes the appended allow rules/)
    expect(rollback).toMatch(/every `results\.yaml`/)
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

  it('covers the Results-specific edge cases', () => {
    const edges = flat(section('Edge Cases'))
    for (const label of [
      '**Experiments without `results.yaml`:**',
      '**Historical values without a Run directory:**',
      '**`±` strings and JSON strings:**',
      '**Legacy per-Run result files (sidecars):**',
      '**Ignored result files:**',
      '**Views that use flat column keys:**',
      '**CLI nodes still on 8.x:**',
    ])
      expect(edges).toContain(label)
    expect(edges).toMatch(/receive an empty `experiment\.json`/)
    expect(edges).toMatch(/stay in that Variant's `frozen` block/)
    expect(edges).toMatch(/Sidecars stay in place; delete them in a separate, user-reviewed commit/)
    // Allow rules: shown in the plan, committed, removed by rollback, the
    // re-inclusion form below an excluded directory, none outside Git.
    expect(edges).toMatch(/shows them before anything is written/)
    expect(edges).toMatch(/committed with the migration and removed by rollback/)
    expect(edges).toContain('`!/logs/`, `/logs/*`, `!/logs/*/`, `/logs/*/*`, `!/logs/*/result.csv`')
    expect(edges).toMatch(/Non-Git projects need no rules/)
    expect(edges).toMatch(/never rewrites View rows/)
  })

  it('uses no hedging language', () => {
    expect(guide).not.toMatch(/\b(might|consider|you could)\b/i)
  })
})
