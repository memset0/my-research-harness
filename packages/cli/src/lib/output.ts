// Output helpers for CLI commands.
//
// Default format: JSON (one big object, agent-friendly).
// `--format human`: tabular / colored, intended for direct human reading.
//
// We intentionally avoid pretty-printing by default — agents pipe the output
// to `jq` or parse it directly, and noise / colors break that.

import { type Hypothesis, type Run, STATUS_EMOJI } from '@memon/core'
import { recordCliInvocationFailureSync } from './invocation.js'

export type OutputFormat = 'json' | 'human'

// ---------- formatters ----------

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function emitHuman(text: string): void {
  process.stdout.write(`${text}\n`)
}

/**
 * Legacy unstructured exit path. It still terminates the process, so it also
 * flushes the invocation receipt: a mutating command that dies here has
 * happened, and a missing receipt would understate the history.
 */
export function emitError(message: string, code = 1): never {
  recordCliInvocationFailureSync('GENERIC')
  process.stderr.write(`memon: ${message}\n`)
  process.exit(code)
}

// ---------- lint diagnostics ----------

/**
 * Shape shared by every lint surface (`memon experiment doc lint`, `memon run
 * lint`). Lint reports format, schema and structure only — research state
 * (missing conclusions, stale runs, deprecated inputs) is never a lint
 * finding, so this carries no severity ladder beyond the document's own.
 */
export interface LintDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  file: string
  field?: string
}

/**
 * Emit one lint report. `subject` carries the identifying fields for the
 * linted object (`{ experimentId }`, `{ runId }`); its first value is the
 * human-mode label. An `error` diagnostic sets exit code 1 without
 * terminating, so a caller may keep emitting.
 */
export function emitLintDiagnostics(
  format: OutputFormat,
  subject: Record<string, string>,
  diagnostics: readonly LintDiagnostic[],
): void {
  const summary = {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
  }
  if (format === 'human') {
    const label = Object.values(subject)[0] ?? ''
    if (diagnostics.length === 0) {
      process.stdout.write(`${label}: lint passed\n`)
    } else {
      const lines = diagnostics.flatMap((diagnostic) => [
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code} (${diagnostic.file}${diagnostic.field ? `:${diagnostic.field}` : ''})`,
        `  ${diagnostic.message}`,
      ])
      process.stdout.write(`${label}: lint\n${lines.join('\n')}\n`)
    }
  } else {
    emitJson({ ok: summary.errors === 0, ...subject, operation: 'lint', diagnostics, summary })
  }
  if (summary.errors > 0) process.exitCode = 1
}

// ---------- formatters for `human` mode ----------

export function formatExperimentRow(exp: Run): string {
  const emoji = STATUS_EMOJI[exp.frontMatter.status]
  const created = exp.frontMatter.createdAt || '?'
  const tags = exp.frontMatter.tags.join(',') || '-'
  const hypotheses = exp.frontMatter.hypotheses.join(',') || '-'
  return `${emoji} ${exp.frontMatter.status.padEnd(8)} ${exp.id.padEnd(40)} ${created.padEnd(28)} ${tags.padEnd(20)} ${hypotheses}`
}

export function formatExperimentTable(exps: Run[]): string {
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
