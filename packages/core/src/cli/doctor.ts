// Doctor — pure scanner that flags experiments needing attention.
// Never writes to disk; the CLI command surfaces issues, the skill drives
// interactive fixes through the existing write commands.

import { scanProjectRoot, type IndexedExperiment } from './scan.js'

export type IssueSeverity = 'info' | 'warn' | 'error'

export type IssueCode =
  | 'MISSING_RESULT'
  | 'MISSING_CONCLUSION'
  | 'FAILED_NO_NOTE'
  | 'STALE_RUNNING'
  | 'PARSE_ERROR'
  | 'PARSE_WARNING'
  | 'ORPHAN_HYPOTHESIS_REF'
  | 'WARN_UNRESOLVED'

export interface DoctorIssue {
  experimentId: string
  code: IssueCode
  severity: IssueSeverity
  message: string
  suggestedAction: string
  /** Optional structured payload (e.g. `count` for WARN_UNRESOLVED). */
  data?: Record<string, unknown>
}

export interface DoctorReport {
  scannedAt: string
  projectRoot: string
  issues: DoctorIssue[]
  summary: {
    total: number
    byCode: Partial<Record<IssueCode, number>>
    bySeverity: Record<IssueSeverity, number>
  }
}

export interface DoctorOptions {
  includeArchived?: boolean
  /** Suppress issues below this severity. Default 'info'. */
  severity?: IssueSeverity
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { info: 0, warn: 1, error: 2 }

export async function runDoctor(
  projectRoot: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const minSeverity = options.severity ?? 'info'
  const minLevel = SEVERITY_ORDER[minSeverity]

  const snapshot = await scanProjectRoot(projectRoot, {
    includeArchived: options.includeArchived,
  })

  const knownHypIds = new Set(snapshot.hypotheses.entries.map((h) => h.id))
  const issues: DoctorIssue[] = []

  for (const exp of snapshot.experiments) {
    issues.push(...inspect(exp, knownHypIds))
  }

  const filtered = issues.filter((i) => SEVERITY_ORDER[i.severity] >= minLevel)

  const byCode: Partial<Record<IssueCode, number>> = {}
  const bySeverity: Record<IssueSeverity, number> = { info: 0, warn: 0, error: 0 }
  for (const i of filtered) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1
    bySeverity[i.severity]++
  }

  return {
    scannedAt: snapshot.scannedAt,
    projectRoot: snapshot.projectRoot,
    issues: filtered,
    summary: { total: filtered.length, byCode, bySeverity },
  }
}

/** Per-experiment rule pass. */
function inspect(exp: IndexedExperiment, knownHypIds: Set<string>): DoctorIssue[] {
  const out: DoctorIssue[] = []
  const fm = exp.frontMatter
  const sec = exp.sections

  if (fm.status === 'FINISHED') {
    if (isBlank(sec.result)) {
      out.push({
        experimentId: exp.id,
        code: 'MISSING_RESULT',
        severity: 'warn',
        message: 'FINISHED experiment has no Result section',
        suggestedAction: 'fill Result, downgrade status to FAILED, or archive',
      })
    }
    if (isBlank(sec.conclusion)) {
      out.push({
        experimentId: exp.id,
        code: 'MISSING_CONCLUSION',
        severity: 'warn',
        message: 'FINISHED experiment has no Conclusion section',
        suggestedAction: 'fill Conclusion or archive',
      })
    }
  }

  if (fm.status === 'FAILED' && isBlank(sec.result)) {
    out.push({
      experimentId: exp.id,
      code: 'FAILED_NO_NOTE',
      severity: 'info',
      message: 'FAILED experiment has no failure note in Result',
      suggestedAction: 'add a one-line note about why it failed, or archive',
    })
  }

  if (exp.stale) {
    out.push({
      experimentId: exp.id,
      code: 'STALE_RUNNING',
      severity: 'info',
      message: 'RUNNING for >1h with no recent fs activity',
      suggestedAction: 'check the process; downgrade to FAILED or refresh mtime',
    })
  }

  if (exp.parseErrors.length > 0) {
    out.push({
      experimentId: exp.id,
      code: 'PARSE_ERROR',
      severity: 'error',
      message: `parseReadme reported ${exp.parseErrors.length} error(s): ${exp.parseErrors.map((e) => e.message).join('; ')}`,
      suggestedAction: 'fix README front-matter / section structure',
    })
  }
  if (exp.parseWarnings.length > 0) {
    out.push({
      experimentId: exp.id,
      code: 'PARSE_WARNING',
      severity: 'warn',
      message: `parseReadme reported ${exp.parseWarnings.length} warning(s): ${exp.parseWarnings.map((w) => w.message).join('; ')}`,
      suggestedAction: 'review and fix the README',
    })
  }

  for (const h of fm.hypotheses) {
    if (!knownHypIds.has(h)) {
      out.push({
        experimentId: exp.id,
        code: 'ORPHAN_HYPOTHESIS_REF',
        severity: 'warn',
        message: `references hypothesis "${h}" which is not in HYPOTHESES.md`,
        suggestedAction: 'fix the hypothesis id, or add the hypothesis to HYPOTHESES.md',
      })
    }
  }

  // Open warnings — informational, never blocks. The doctor sweep skill
  // surfaces these to the human; a project with no open warnings is silent
  // here. The `count` field lets the consumer order or filter by noise.
  const openWarnings = exp.warnings.filter((w) => w.status === 'OPEN')
  if (openWarnings.length > 0) {
    out.push({
      experimentId: exp.id,
      code: 'WARN_UNRESOLVED',
      severity: 'info',
      message: `${openWarnings.length} unresolved warning${openWarnings.length === 1 ? '' : 's'}`,
      suggestedAction: 'review and resolve via the web UI or `memon experiment warning resolve`',
      data: { count: openWarnings.length },
    })
  }

  return out
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0
}
