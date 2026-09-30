import { describe, expect, it } from 'vitest'
import { parseSqueueOutput } from './squeue'

// Output shape with each field carrying a `:|` suffix in `-O`: one `|`
// after every field, including the last. The parser drops the trailing
// empty token.
const SAMPLE = `\
1617918|main|shao_dll|R|3:39:55|1|fs-mbz-gpu-111|
1608163|main|video|R|4-21:58:30|1|fs-mbz-gpu-469|
1608151|main|sparse-r|R|4-22:35:34|1|fs-mbz-gpu-753|
1553751|main|video|R|30-02:08:50|1|fs-mbz-gpu-045|
`

describe('parseSqueueOutput', () => {
  it('parses 4 R-state rows from a representative pipe-delimited stdout', () => {
    const jobs = parseSqueueOutput(SAMPLE)
    expect(jobs).toHaveLength(4)
    expect(jobs[0]).toEqual({
      jobId: '1617918',
      partition: 'main',
      name: 'shao_dll',
      state: 'R',
      time: '3:39:55',
      numNodes: 1,
      nodeList: 'fs-mbz-gpu-111',
    })
    expect(jobs[1]!.time).toBe('4-21:58:30')
    expect(jobs[3]!.nodeList).toBe('fs-mbz-gpu-045')
    expect(jobs.every((j) => j.state === 'R' && j.numNodes === 1)).toBe(true)
  })

  it('returns [] for empty stdout (user has no jobs)', () => {
    expect(parseSqueueOutput('')).toEqual([])
    expect(parseSqueueOutput('\n\n   \n')).toEqual([])
  })

  it('handles multi-node NodeList compact form', () => {
    const jobs = parseSqueueOutput('2000001|main|multinode|R|0:30|2|fs-mbz-gpu-[111,469]|\n')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.numNodes).toBe(2)
    expect(jobs[0]!.nodeList).toBe('fs-mbz-gpu-[111,469]')
  })

  it('preserves pending (PD) rows', () => {
    const jobs = parseSqueueOutput('2000002|main|waiting|PD|0:00|4|(Resources)|\n')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.state).toBe('PD')
    expect(jobs[0]!.nodeList).toBe('(Resources)')
  })

  // Regression: with the previous whitespace-delimited format, a job
  // name that exactly filled slurm's default 20-char Name column fused
  // with the next column (e.g. `lk-lambda-eta10-coldR`) and the parser
  // saw 6 fields instead of 7. Pipe-delimited output preserves the
  // boundary even with no whitespace between fields.
  it('handles names that would overflow the default 20-char Name column', () => {
    const jobs = parseSqueueOutput('1618473|main|lk-lambda-eta10-cold|R|6:44|1|fs-mbz-gpu-185|\n')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.name).toBe('lk-lambda-eta10-cold')
    expect(jobs[0]!.state).toBe('R')
  })

  it('throws on a line with the wrong column count', () => {
    expect(() => parseSqueueOutput('1|2|3|\n')).toThrow(/expected 7 pipe-delimited columns/)
  })

  it('throws when NumNodes is not an integer', () => {
    expect(() => parseSqueueOutput('1|main|n|R|0:00|oops|fs-mbz-gpu-111|\n')).toThrow(
      /NumNodes is not an integer/,
    )
  })
})
