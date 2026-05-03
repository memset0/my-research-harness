import { describe, expect, it } from 'vitest'
import { parseArtifacts } from './artifacts.js'

describe('parseArtifacts', () => {
  it('parses em-dash separated entries', () => {
    const body = `
- \`./checkpoints/\` — 训练 checkpoint
- \`./outputs/loss.csv\` — 每步 loss
- \`./logs/stdout.log\` — 训练 stdout
    `.trim()
    expect(parseArtifacts(body)).toEqual([
      { path: './checkpoints/', description: '训练 checkpoint' },
      { path: './outputs/loss.csv', description: '每步 loss' },
      { path: './logs/stdout.log', description: '训练 stdout' },
    ])
  })

  it('accepts hyphen and en-dash separators', () => {
    expect(parseArtifacts('- `./a` - alpha\n- `./b` – beta')).toEqual([
      { path: './a', description: 'alpha' },
      { path: './b', description: 'beta' },
    ])
  })

  it('skips lines that do not match', () => {
    const body = '- random prose\n- `./foo` — bar\nrandom line'
    expect(parseArtifacts(body)).toEqual([{ path: './foo', description: 'bar' }])
  })

  it('returns empty array for empty body', () => {
    expect(parseArtifacts('')).toEqual([])
  })
})
