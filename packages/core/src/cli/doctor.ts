// Doctor — pure scanner that flags experiments needing attention.
// Never writes to disk; the CLI command surfaces issues, the skill drives
// interactive fixes through the existing write commands.

import { discoverExperiments } from '../experiments/discover.js'
import { computeMembership } from '../experiments/membership.js'
import { scanProjectRoot, type IndexedRun } from './scan.js'

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
  // v4-added — see lifecycle-frontmatter-v4.
  | 'INTERRUPTED_NO_NOTE'
  | 'RESOLVED_NO_CONCLUSION'
  // v3 task 8.1 — exp ↔ run binding rules. Codes mirror the
  // `ExperimentMembershipAnomalyCode` set so doctor output is the same
  // string the web /api/anomalies endpoint emits, and the same string a
  // human sees in `memon experiment create` failure paths.
  | 'ORPHAN_RUN'
  | 'PHANTOM_RUN_REF'
  | 'MISMATCH_EXPERIMENT_REF'
  | 'RUN_SLUG_PREFIX_VIOLATION'
  | 'DUPLICATE_EXPERIMENT_SLUG'
  | 'EXPERIMENT_SLUG_PREFIX_COLLISION'

export interface DoctorIssue {
  runId: string
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

  // v3 task 8.1: surface exp-doc binding anomalies. Discover exp docs +
  // compute membership against the same run set the legacy rules saw, so
  // a single `memon doctor` pass shows v2 + v3 issues together. The
  // project label is best-effort — scan doesn't know the configured name,
  // so use the run dir's project label or "(scan)" for synthetic snapshots.
  try {
    const projectName = snapshot.experiments[0]?.project ?? '(scan)'
    const { experiments: expDocs } = await discoverExperiments(snapshot.projectRoot, projectName)

    // v4: per-exp-doc lints (RESOLVED_NO_CONCLUSION). Mirrors the v3
    // run-side MISSING_CONCLUSION lint, but for the exp doc's manual
    // status === 'RESOLVED'.
    for (const expDoc of expDocs) {
      if (expDoc.frontMatter.status === 'RESOLVED' && isBlank(expDoc.sections.conclusion)) {
        issues.push({
          runId: expDoc.id,
          code: 'RESOLVED_NO_CONCLUSION',
          severity: 'info',
          message: 'RESOLVED experiment has no Conclusion section',
          suggestedAction:
            'add a one-line conclusion describing what the investigation concluded, or set status back to OPEN',
        })
      }
    }

    const { anomalies } = computeMembership({
      experiments: expDocs,
      runs: snapshot.experiments,
      project: projectName,
    })
    for (const a of anomalies) {
      const severity: IssueSeverity =
        a.code === 'MISMATCH_EXPERIMENT_REF' || a.code === 'EXPERIMENT_SLUG_PREFIX_COLLISION'
          ? 'error'
          : a.code === 'RUN_SLUG_PREFIX_VIOLATION'
            ? 'info'
            : 'warn'
      issues.push({
        runId: a.runId ?? a.experimentId ?? '(?)',
        code: a.code,
        severity,
        message: a.message,
        suggestedAction:
          a.code === 'ORPHAN_RUN'
            ? 'bind the run via `memon experiment link <exp> <run>` or set its `experiment:` field'
            : a.code === 'PHANTOM_RUN_REF'
              ? 'remove the stale entry from the experiment doc\'s `runs:` field, or restore the missing run dir'
              : a.code === 'MISMATCH_EXPERIMENT_REF'
                ? 'unlink + re-link to bring both sides into agreement'
                : a.code === 'RUN_SLUG_PREFIX_VIOLATION'
                  ? 'rename the run via `memon run rename` so its slug starts with the experiment slug'
                  : a.code === 'DUPLICATE_EXPERIMENT_SLUG' ||
                      a.code === 'EXPERIMENT_SLUG_PREFIX_COLLISION'
                    ? 'rename or merge one of the colliding experiment docs'
                    : 'see message',
      })
    }
  } catch {
    // Best-effort — never block doctor on v3 discovery failure (e.g. no
    // docs/experiments/ dir at all on a v2-only project).
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
function inspect(exp: IndexedRun, knownHypIds: Set<string>): DoctorIssue[] {
  const out: DoctorIssue[] = []
  const fm = exp.frontMatter
  const sec = exp.sections

  if (fm.status === 'FINISHED') {
    if (isBlank(sec.result)) {
      out.push({
        runId: exp.id,
        code: 'MISSING_RESULT',
        severity: 'warn',
        message: 'FINISHED experiment has no Result section',
        suggestedAction: 'fill Result, downgrade status to FAILED, or archive',
      })
    }
    if (isBlank(sec.conclusion)) {
      out.push({
        runId: exp.id,
        code: 'MISSING_CONCLUSION',
        severity: 'warn',
        message: 'FINISHED experiment has no Conclusion section',
        suggestedAction: 'fill Conclusion or archive',
      })
    }
  }

  if (fm.status === 'FAILED' && isBlank(sec.result)) {
    out.push({
      runId: exp.id,
      code: 'FAILED_NO_NOTE',
      severity: 'info',
      message: 'FAILED experiment has no failure note in Result',
      suggestedAction: 'add a one-line note about why it failed, or archive',
    })
  }

  // v4: INTERRUPTED runs should leave a note in Result describing why the
  // user (or agent) stopped them. Symmetric with FAILED_NO_NOTE.
  if (fm.status === 'INTERRUPTED' && isBlank(sec.result)) {
    out.push({
      runId: exp.id,
      code: 'INTERRUPTED_NO_NOTE',
      severity: 'info',
      message: 'INTERRUPTED experiment has no note in Result describing why it was stopped',
      suggestedAction: 'add a one-line note (e.g. "killed: bad hyperparameter")',
    })
  }

  if (exp.stale) {
    out.push({
      runId: exp.id,
      code: 'STALE_RUNNING',
      severity: 'info',
      message: 'RUNNING for >1h with no recent fs activity',
      suggestedAction: 'check the process; downgrade to FAILED or refresh mtime',
    })
  }

  if (exp.parseErrors.length > 0) {
    out.push({
      runId: exp.id,
      code: 'PARSE_ERROR',
      severity: 'error',
      message: `parseReadme reported ${exp.parseErrors.length} error(s): ${exp.parseErrors.map((e) => e.message).join('; ')}`,
      suggestedAction: 'fix README front-matter / section structure',
    })
  }
  if (exp.parseWarnings.length > 0) {
    out.push({
      runId: exp.id,
      code: 'PARSE_WARNING',
      severity: 'warn',
      message: `parseReadme reported ${exp.parseWarnings.length} warning(s): ${exp.parseWarnings.map((w) => w.message).join('; ')}`,
      suggestedAction: 'review and fix the README',
    })
  }

  for (const h of fm.hypotheses) {
    if (!knownHypIds.has(h)) {
      out.push({
        runId: exp.id,
        code: 'ORPHAN_HYPOTHESIS_REF',
        severity: 'warn',
        message: `references hypothesis "${h}" which is not in docs/hypotheses.md`,
        suggestedAction: 'fix the hypothesis id, or add the hypothesis to docs/hypotheses.md',
      })
    }
  }

  // Open warnings — informational, never blocks. The doctor sweep skill
  // surfaces these to the human; a project with no open warnings is silent
  // here. The `count` field lets the consumer order or filter by noise.
  const openWarnings = exp.warnings.filter((w) => w.status === 'OPEN')
  if (openWarnings.length > 0) {
    out.push({
      runId: exp.id,
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
