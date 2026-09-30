// v6 Run record: minimal documents are first-class, legacy rich documents
// keep parsing, and the orthogonal `deprecated` flag survives a round-trip.

import { describe, expect, it } from 'vitest'
import { patchRunFrontMatter } from './frontmatter-patch.js'
import { parseReadme } from './parse.js'
import { reserializeReadme, serializeMinimalRun } from './serialize.js'

const MINIMAL = `---
id: sweep-260901-101500
name: sweep
status: RUNNING
experiment: E0007-lr-sweep
created_at: '2026-09-01T10:15:00+08:00'
host: gpu-04
pid: 4211
gpus: [0, 1]
command: torchrun train.py --lr 3e-4
---

Launched from the v6 minimal template; nothing here repeats the Experiment.
`

const LEGACY_RICH = `---
id: ablation-260501-100000
name: ablation
project: diffusion
status: FINISHED
experiment: E0001-ablation
created_at: '2026-05-01T10:00:00+08:00'
updated_at: '2026-05-02T11:00:00+08:00'
finished_at: '2026-05-01T18:00:00+08:00'
host: node-1
pid: 99
gpus: [0]
archived: false
entry: ./run.sh
command: bash run.sh
wandb: https://wandb.ai/x/y/runs/z
hypotheses: [H0003]
tags: [ablation]
---

## Motivation

Check whether zero-SNR helps.

## Setup

8xA100, bf16.

## Result

FID 12.4.

## Artifacts

- \`ckpt/last.pt\` — final checkpoint
`

describe('minimal Run record', () => {
  it('parses without errors and without demanding narrative sections', () => {
    const parsed = parseReadme(MINIMAL)

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.frontMatter.id).toBe('sweep-260901-101500')
    expect(parsed.frontMatter.status).toBe('RUNNING')
    expect(parsed.frontMatter.experiment).toBe('E0007-lr-sweep')
    expect(parsed.frontMatter.gpus).toEqual([0, 1])
    // Absent keys default silently — no warning for archived/deprecated.
    expect(parsed.frontMatter.archived).toBe(false)
    expect(parsed.frontMatter.deprecated).toBe(false)
    expect(parsed.parseWarnings.map((issue) => issue.field)).not.toContain('archived')
    expect(parsed.frontMatterKeys).toContain('command')
    expect(parsed.frontMatterKeys).not.toContain('archived')
    expect(parsed.frontMatterKeys).not.toContain('deprecated')
  })

  it('round-trips minimal shape: no invented sections, no defaulted keys', () => {
    const parsed = parseReadme(MINIMAL)
    const out = reserializeReadme(parsed)

    expect(out).not.toContain('## ')
    expect(out).not.toContain('archived:')
    expect(out).not.toContain('deprecated:')
    expect(out).not.toContain('hypotheses:')
    expect(out).not.toContain('tags:')
    expect(out).toContain('Launched from the v6 minimal template')
    // Stable under a second pass.
    expect(reserializeReadme(parseReadme(out))).toBe(out)
  })

  it('preserves an arbitrary body verbatim across a metadata mutation', () => {
    const messy = MINIMAL.replace(
      'Launched from the v6 minimal template; nothing here repeats the Experiment.',
      [
        'Preamble notes before any heading.',
        '',
        '## Result',
        '',
        'loss 0.31 (kept here because that is where I wrote it)',
        '',
        '## Scratch',
        '',
        '- resumed twice',
        '- see /scratch/logs/2026-09-01',
      ].join('\n'),
    )
    const parsed = parseReadme(messy)
    parsed.frontMatter.status = 'FINISHED'
    const out = reserializeReadme(parsed)

    expect(out).toContain('status: FINISHED')
    // Every paragraph survives: no chapter reconstruction, no reordering,
    // no dropped unrecognized section, no invented headings.
    expect(out.slice(out.indexOf('Preamble notes'))).toBe(
      messy.slice(messy.indexOf('Preamble notes')),
    )
    expect(out).not.toContain('## Motivation')
    expect(out).not.toContain('## Artifacts')
  })

  it('emits `deprecated: true` only when the flag is set', () => {
    const parsed = parseReadme(MINIMAL)
    expect(serializeMinimalRun({ frontMatter: parsed.frontMatter })).not.toContain('deprecated')

    parsed.frontMatter.deprecated = true
    const out = serializeMinimalRun({ frontMatter: parsed.frontMatter, body: parsed.body })
    expect(out).toContain('deprecated: true')
    expect(parseReadme(out).frontMatter.deprecated).toBe(true)
  })
})

describe('legacy rich Run record', () => {
  it('changes only requested metadata even with unknown fields and malformed legacy references', () => {
    const source = `---
id: sweep-260901-101500
"status": &execution RUNNING # keep this comment
created_at: '2026-09-01T10:15:00+08:00'
x_custom: {retained: [a, b]}
hypotheses: [H1]
---


## Scratch
Keep trailing spaces here.  

`
    const parsed = parseReadme(source)
    parsed.frontMatter.status = 'FINISHED'
    expect(reserializeReadme(parsed)).toBe(source.replace('RUNNING #', 'FINISHED #'))
  })

  it('still parses frontmatter, sections, and artifacts', () => {
    const parsed = parseReadme(LEGACY_RICH)

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.frontMatter.project).toBe('diffusion')
    expect(parsed.frontMatter.hypotheses).toEqual(['H0003'])
    expect(parsed.sections.setup).toContain('8xA100')
    expect(parsed.sections.result).toContain('FID 12.4')
    expect(parsed.sections.artifacts).toEqual([
      { path: 'ckpt/last.pt', description: 'final checkpoint' },
    ])
    expect(parsed.frontMatter.deprecated).toBe(false)
    expect(parsed.sections.method).toBeNull()
  })

  it('keeps the rich shape when re-serialized', () => {
    const out = reserializeReadme(parseReadme(LEGACY_RICH))
    expect(out).toContain('## Setup')
    expect(out).toContain('## Artifacts')
    expect(out).toContain('archived: false')
  })

  it('does not drop pre-v5 Method/Conclusion/Caveats content on an unrelated edit', () => {
    const withChapters = LEGACY_RICH.replace(
      '## Result',
      '## Method\n\nDDIM 50 steps, cfg 3.\n\n## Result',
    ).replace(
      '## Artifacts',
      '## Conclusion\n\nZero-SNR wins.\n\n## Caveats\n\nOne seed only.\n\n## Artifacts',
    )
    const parsed = parseReadme(withChapters)
    expect(parsed.sections.method).toContain('DDIM 50 steps')

    // An archive/status edit round-trips through the serializer; legacy
    // chapters are content, not policy violations.
    parsed.frontMatter.archived = true
    const out = reserializeReadme(parsed)
    expect(out).toContain('DDIM 50 steps, cfg 3.')
    expect(out).toContain('Zero-SNR wins.')
    expect(out).toContain('One seed only.')
    expect(out).toContain('archived: true')
    // Canonical order: Method after Setup, Conclusion/Caveats after Result.
    expect(out.indexOf('## Method')).toBeGreaterThan(out.indexOf('## Setup'))
    expect(out.indexOf('## Conclusion')).toBeGreaterThan(out.indexOf('## Result'))
    expect(out.indexOf('## Artifacts')).toBeGreaterThan(out.indexOf('## Caveats'))
    // A run without those chapters gains no empty headings.
    expect(reserializeReadme(parseReadme(LEGACY_RICH))).not.toContain('## Method')
  })
})

describe('patchRunFrontMatter', () => {
  it('updates quoted keys in flow YAML and restores an added flag without changing surrounding bytes', () => {
    const source = `---
{ id: sweep-260901-101500, "status": FINISHED, created_at: '2026-09-01T10:15:00+08:00' }
---
Body stays unchanged.
`
    const deprecated = patchRunFrontMatter(source, { deprecated: true })
    expect(parseReadme(deprecated).frontMatter.deprecated).toBe(true)
    expect(patchRunFrontMatter(deprecated, { deprecated: null })).toBe(source)
    const changed = patchRunFrontMatter(source, { status: 'FAILED' })
    expect(changed).toBe(source.replace('FINISHED', 'FAILED'))
  })

  it('flips a flag without touching the body or other keys', () => {
    const patched = patchRunFrontMatter(LEGACY_RICH, {
      deprecated: true,
      updated_at: "'2026-09-08T09:00:00+08:00'",
    })

    expect(patched).toContain('deprecated: true')
    expect(patched).toContain("updated_at: '2026-09-08T09:00:00+08:00'")
    expect(patched.slice(patched.indexOf('## Motivation'))).toBe(
      LEGACY_RICH.slice(LEGACY_RICH.indexOf('## Motivation')),
    )
    expect(patched).toContain('hypotheses: [H0003]')
    expect(parseReadme(patched).frontMatter.deprecated).toBe(true)
  })

  it('removes a key when patched to null, restoring the original bytes', () => {
    const deprecated = patchRunFrontMatter(MINIMAL, { deprecated: true })
    const restored = patchRunFrontMatter(deprecated, { deprecated: null })

    expect(restored).toBe(MINIMAL)
  })
})
