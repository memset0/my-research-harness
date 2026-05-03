// Output helpers for CLI commands.
//
// Default format: JSON (one big object, agent-friendly).
// `--format human`: tabular / colored, intended for direct human reading.
//
// We intentionally avoid pretty-printing by default — agents pipe the output
// to `jq` or parse it directly, and noise / colors break that.

import { STATUS_EMOJI, type Experiment, type Hypothesis } from '@memon/core'

export type OutputFormat = 'json' | 'human'

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function emitHuman(text: string): void {
  process.stdout.write(`${text}\n`)
}

export function emitError(message: string, code = 1): never {
  process.stderr.write(`memon: ${message}\n`)
  process.exit(code)
}

// ---------- formatters for `human` mode ----------

export function formatExperimentRow(exp: Experiment): string {
  const emoji = STATUS_EMOJI[exp.frontMatter.status]
  const created = exp.frontMatter.createdAt || '?'
  const tags = exp.frontMatter.tags.join(',') || '-'
  const hypotheses = exp.frontMatter.hypotheses.join(',') || '-'
  return `${emoji} ${exp.frontMatter.status.padEnd(8)} ${exp.id.padEnd(40)} ${created.padEnd(28)} ${tags.padEnd(20)} ${hypotheses}`
}

export function formatExperimentTable(exps: Experiment[]): string {
  if (exps.length === 0) return '(no experiments)'
  const header = `   ${'STATUS'.padEnd(8)} ${'ID'.padEnd(40)} ${'CREATED'.padEnd(28)} ${'TAGS'.padEnd(20)} HYPOTHESES`
  return [header, ...exps.map(formatExperimentRow)].join('\n')
}

export function formatHypothesisRow(h: Hypothesis): string {
  return `${h.id.padEnd(6)} ${h.status.padEnd(10)} ${h.statement.slice(0, 80)}`
}

export function formatHypothesisTable(hs: Hypothesis[]): string {
  if (hs.length === 0) return '(no hypotheses)'
  const header = `${'ID'.padEnd(6)} ${'STATUS'.padEnd(10)} STATEMENT`
  return [header, ...hs.map(formatHypothesisRow)].join('\n')
}
