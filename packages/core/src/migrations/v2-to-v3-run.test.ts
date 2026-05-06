// v3-spec-sync task 2.2 — deterministic v2 → v3 run README rewrite test.
//
// Scope: this covers the MECHANICAL part of the v2 → v3 migration only.
// The full migration recipe (`packages/core/migrations/v2-to-v3.md`)
// also requires a clustering / user-confirm phase that is not testable
// without a real conversation; we test only the deterministic transform
// that runs AFTER the user has committed to a clustering.
//
// Two run fixtures live at `packages/core/test-fixtures/v2-mock/logs/`.
// Each is hand-written v2 (has `project:`/`hypotheses:`/`tags:` in
// frontmatter; full Motivation/Method/Conclusion/Caveats/Warnings/New
// Hypotheses body sections). The test invokes `rewriteV2RunReadme` and
// asserts the output:
//   - drops legacy frontmatter fields
//   - emits `experiment` + `updated_at` lines
//   - keeps only Setup / Result / Artifacts body sections
//   - is idempotent: running rewrite on the v3 output is a no-op
//     (modulo the migration-time mutating updated_at)

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseReadme } from '../readme/parse.js'
import { rewriteV2RunReadme } from './v2-to-v3-run.js'

const FIXTURE_DIR = join(__dirname, '..', '..', 'test-fixtures', 'v2-mock', 'logs')
const MIGRATION_TIME = '2026-05-06T18:00:00+08:00'

async function readFixture(runDir: string): Promise<string> {
  return fs.readFile(join(FIXTURE_DIR, runDir, 'README.md'), 'utf8')
}

describe('rewriteV2RunReadme — v2 → v3 deterministic transform', () => {
  it('rewrites a fully-populated v2 README to canonical v3 shape', async () => {
    const v2 = await readFixture('ablation-260501-100000')
    const v3 = rewriteV2RunReadme({
      v2Content: v2,
      experiment: 'E0001-ablation',
      migrationTime: MIGRATION_TIME,
    })

    // Frontmatter shape: legacy fields gone, v3 fields present
    expect(v3).toContain('experiment: ')
    expect(v3).toContain('updated_at: ')
    expect(v3).toContain('E0001-ablation')
    expect(v3).toContain(MIGRATION_TIME)
    expect(v3).not.toContain('project: example-project')
    expect(v3).not.toContain('hypotheses: [H0001')
    expect(v3).not.toContain('tags: [ablation')

    // Body shape: only kept sections survive
    expect(v3).toContain('## Setup')
    expect(v3).toContain('## Result')
    expect(v3).toContain('## Artifacts')
    // The migrated-away sections are stripped (their headings are gone
    // because the canonical serializer omits empty sections — except
    // for the four it always emits, but those are gone too in v3-run).
    // Confirm the prose content is gone:
    expect(v3).not.toContain('搬到 exp doc')
    expect(v3).not.toContain('warmup matters more than expected') // New Hypotheses
    expect(v3).not.toContain('loss spike at step 1500') // Warnings table

    // Frontmatter scalars round-trip
    const parsed = parseReadme(v3)
    expect(parsed.frontMatter.id).toBe('ablation-260501-100000')
    expect(parsed.frontMatter.status).toBe('FINISHED')
    expect(parsed.frontMatter.experiment).toBe('E0001-ablation')
    expect(parsed.frontMatter.updatedAt).toBe(MIGRATION_TIME)
    expect(parsed.frontMatter.host).toBe('gpu-04')
    expect(parsed.frontMatter.gpus).toEqual([0, 1, 2, 3])
    expect(parsed.frontMatter.command).toBe('bash run.sh --bs=8')
  })

  it('handles a sparser v2 README (no Warnings, no New Hypotheses)', async () => {
    const v2 = await readFixture('ablation-260502-140000')
    const v3 = rewriteV2RunReadme({
      v2Content: v2,
      experiment: 'E0001-ablation',
      migrationTime: MIGRATION_TIME,
    })

    expect(v3).toContain('experiment: ')
    expect(v3).toContain('E0001-ablation')
    expect(v3).not.toContain('## Motivation')
    expect(v3).not.toContain('## Method')
    expect(v3).not.toContain('## Conclusion')
    expect(v3).not.toContain('## Caveats')

    const parsed = parseReadme(v3)
    expect(parsed.frontMatter.status).toBe('FAILED')
    expect(parsed.frontMatter.experiment).toBe('E0001-ablation')
    expect(parsed.parseErrors).toEqual([])
  })

  it('accepts experiment=null for an unbound run', async () => {
    const v2 = await readFixture('ablation-260502-140000')
    const v3 = rewriteV2RunReadme({
      v2Content: v2,
      experiment: null,
      migrationTime: MIGRATION_TIME,
    })
    const parsed = parseReadme(v3)
    expect(parsed.frontMatter.experiment).toBeNull()
  })

  it('is idempotent on the v3 output (modulo updated_at)', async () => {
    const v2 = await readFixture('ablation-260502-140000')
    const v3a = rewriteV2RunReadme({
      v2Content: v2,
      experiment: 'E0001-ablation',
      migrationTime: MIGRATION_TIME,
    })
    // Re-run rewrite on the v3 output; updated_at advances but
    // everything else is byte-identical.
    const NEW_TIME = '2026-06-01T00:00:00+08:00'
    const v3b = rewriteV2RunReadme({
      v2Content: v3a,
      experiment: 'E0001-ablation',
      migrationTime: NEW_TIME,
    })
    expect(v3b).toContain(NEW_TIME)
    expect(v3b).not.toContain(MIGRATION_TIME)
    // Replace timestamps and assert the rest matches
    const norm = (s: string) =>
      s.replace(/updated_at: .+$/m, 'updated_at: <T>')
    expect(norm(v3b)).toBe(norm(v3a))
  })
})
