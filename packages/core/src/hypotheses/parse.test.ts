import { describe, expect, it } from 'vitest'
import { parseHypotheses } from './parse.js'

const SAMPLE = `# Hypotheses

## Status legend

| Symbol | Status |
| :---:  | --- |
| ✅ | CONFIRMED |
| ❌ | REFUTED |

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H0001 | foo | ✅ | exp-260501-100000 |

## H0001. per-step-bf16-param-delta-is-sparse

- **Statement**: 在 bf16 表示下相邻 optimizer step 之间 >99% 的 param 位置保持完全不变
- **Origin**: research-plan.md 的 Core Idea
- **Status**: ✅ CONFIRMED
- **Experiments**: foo-260501-100000 (data) → bar-260502-150000 (analysis)
- **Evidence**:
  - 1-step bit_equal = 99.89%
  - 32-step bit_equal = 98.85%
- **Caveats**:
  - 强绑定 lr=1e-6
- **Last verified**: 2026-04-11

## H0002. some-other-hypothesis

- **Statement**: another claim
- **Origin**: derived
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`

describe('parseHypotheses', () => {
  it('parses entries, statuses, evidence, and experiment IDs', () => {
    const parsed = parseHypotheses(SAMPLE)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.entries).toHaveLength(2)
    const h1 = parsed.entries[0]!
    expect(h1.id).toBe('H0001')
    expect(h1.slug).toBe('per-step-bf16-param-delta-is-sparse')
    expect(h1.status).toBe('CONFIRMED')
    expect(h1.experiments).toEqual(['foo-260501-100000', 'bar-260502-150000'])
    expect(h1.evidence).toContain('1-step bit_equal = 99.89%')
    expect(h1.caveats).toContain('强绑定 lr=1e-6')
    expect(h1.lastVerified).toBe('2026-04-11')

    const h2 = parsed.entries[1]!
    expect(h2.id).toBe('H0002')
    expect(h2.status).toBe('OPEN')
    expect(h2.experiments).toEqual([])
    expect(h2.lastVerified).toBeNull()
  })

  it('captures legend and summary table blocks', () => {
    const parsed = parseHypotheses(SAMPLE)
    expect(parsed.legendBlock).toContain('CONFIRMED')
    expect(parsed.summaryTableBlock).toContain('exp-260501-100000')
  })

  it('warns on duplicate hypothesis IDs', () => {
    const dup = `${SAMPLE}\n## H0001. duplicate\n- **Statement**: dup\n- **Origin**: x\n- **Status**: ❌ REFUTED\n- **Experiments**: —\n- **Evidence**:\n- **Caveats**:\n- **Last verified**: —\n`
    const parsed = parseHypotheses(dup)
    expect(parsed.parseWarnings.some((w) => w.field === 'H0001' && /DUPLICATE_HYPOTHESIS_ID/.test(w.message))).toBe(true)
    expect(parsed.entries.filter((e) => e.id === 'H0001')).toHaveLength(1)
  })

  it('emits error on unparseable status', () => {
    const bad = `## H0009. bad-status

- **Statement**: x
- **Origin**: y
- **Status**: 🤷 huh
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`
    const parsed = parseHypotheses(bad)
    expect(parsed.parseErrors.some((e) => e.field === 'H0009.Status')).toBe(true)
  })

  it('warns and skips unpadded hypothesis heading', () => {
    const unpadded = `## H1. legacy-form

- **Statement**: x
- **Origin**: y
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`
    const parsed = parseHypotheses(unpadded)
    expect(parsed.parseWarnings.some((w) => /INVALID_HYPOTHESIS_ID/.test(w.message))).toBe(true)
    expect(parsed.entries).toEqual([])
  })

  it('warns and skips out-of-range heading (H10000)', () => {
    const tooLong = `## H10000. overflow-form

- **Statement**: x
- **Origin**: y
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`
    const parsed = parseHypotheses(tooLong)
    expect(parsed.parseWarnings.some((w) => /INVALID_HYPOTHESIS_ID/.test(w.message))).toBe(true)
    expect(parsed.entries).toEqual([])
  })

  it('warns and skips H0000 (value zero)', () => {
    const zero = `## H0000. zero-form

- **Statement**: x
- **Origin**: y
- **Status**: 🔵 OPEN
- **Experiments**: —
- **Evidence**:
- **Caveats**:
- **Last verified**: —
`
    const parsed = parseHypotheses(zero)
    expect(parsed.parseWarnings.some((w) => /INVALID_HYPOTHESIS_ID/.test(w.message))).toBe(true)
    expect(parsed.entries).toEqual([])
  })

  it('handles empty document', () => {
    const parsed = parseHypotheses('')
    expect(parsed.entries).toEqual([])
    expect(parsed.parseErrors).toEqual([])
  })
})
