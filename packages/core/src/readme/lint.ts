// lintRun — structural lint for a single Run README.
//
// Scope is deliberately narrow: FORMAT, SCHEMA, and STRUCTURE only. This
// pass answers "is this document well-formed and self-consistent?", never
// "is this good research?". It therefore reports nothing about:
//   - status semantics beyond the enum (a stale RUNNING run lints clean)
//   - deprecation (a `deprecated: true` run lints clean — deprecation is a
//     research-eligibility flag, not a defect)
//   - missing narrative content (a v6 Run body is free-form; there are no
//     mandatory chapters and Experiment prose is never repeated per run)
//
// Diagnostics use the same shape as `ExperimentDocumentDiagnostic` so one
// emitter can render both.

import type { Dirent } from 'node:fs'
import { projectFs } from '../project-file-store.js'
import type { ParseIssue, Run } from '../types.js'
import { EXPERIMENT_DIR_REGEX, RUN_DIR_REGEX } from '../types.js'

export interface RunLintDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  file: string
  field?: string
  message: string
}

/** ISO8601 with an explicit offset (or `Z`) — the only timestamp memon writes. */
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Structural diagnostics for one Run. Ordering: parse errors, parse
 * warnings/infos, then the structural checks in frontmatter key order.
 */
export function lintRun(run: Run): RunLintDiagnostic[] {
  const diagnostics: RunLintDiagnostic[] = run.parseErrors.map((issue) =>
    fromParseIssue(issue, 'error'),
  )
  for (const issue of run.parseWarnings) diagnostics.push(fromParseIssue(issue))

  if (!run.hasReadme) {
    diagnostics.push({
      code: 'RUN_README_MISSING',
      severity: 'error',
      file: 'README.md',
      message: `run directory ${run.path} has no README.md; id, name, and created_at were synthesized from the directory name`,
    })
    return diagnostics
  }

  const fm = run.frontMatter
  if (fm.id === '') {
    diagnostics.push({
      code: 'RUN_ID_MISSING',
      severity: 'error',
      file: 'README.md',
      field: 'id',
      message: 'frontmatter `id` is required',
    })
  } else if (fm.id !== run.id) {
    diagnostics.push({
      code: 'RUN_ID_MISMATCH',
      severity: 'error',
      file: 'README.md',
      field: 'id',
      message: `frontmatter id "${fm.id}" does not match the run directory name "${run.id}"`,
    })
  } else if (!RUN_DIR_REGEX.test(fm.id)) {
    diagnostics.push({
      code: 'RUN_ID_MALFORMED',
      severity: 'error',
      file: 'README.md',
      field: 'id',
      message: `run id "${fm.id}" is not <slug>-<YYMMDD>-<HHMMSS>`,
    })
  }

  if (fm.experiment !== null && !EXPERIMENT_DIR_REGEX.test(fm.experiment)) {
    diagnostics.push({
      code: 'RUN_EXPERIMENT_REF_MALFORMED',
      severity: 'error',
      file: 'README.md',
      field: 'experiment',
      message: `experiment reference "${fm.experiment}" is not E<NNNN>-<slug>`,
    })
  }
  if (fm.experiment !== null) {
    // FS v7: membership is declared only by the Experiment's `runs`; a Run
    // README parent field is obsolete and never decides ownership.
    diagnostics.push({
      code: 'RUN_LEGACY_EXPERIMENT_FIELD',
      severity: 'warning',
      file: 'README.md',
      field: 'experiment',
      message: `obsolete "experiment: ${fm.experiment}" field; membership is declared by the Experiment's runs list (remove this field)`,
    })
  }

  for (const [field, value] of [
    ['created_at', fm.createdAt],
    ['updated_at', fm.updatedAt],
    ['finished_at', fm.finishedAt],
  ] as const) {
    if (value === null) continue
    if (value === '') {
      // `created_at` is the only timestamp a minimal record must carry;
      // `updated_at` defaults to it and `finished_at` stays null until exit.
      if (field === 'created_at') {
        diagnostics.push({
          code: 'RUN_CREATED_AT_MISSING',
          severity: 'error',
          file: 'README.md',
          field,
          message: 'frontmatter `created_at` is required and could not be derived',
        })
      }
      continue
    }
    if (!ISO_OFFSET.test(value)) {
      diagnostics.push({
        code: 'RUN_TIMESTAMP_MALFORMED',
        severity: 'error',
        file: 'README.md',
        field,
        message: `\`${field}\` must be ISO8601 with an explicit offset; got "${value}"`,
      })
    }
  }

  for (const entry of run.sections.artifacts) {
    if (entry.path.trim() === '') {
      diagnostics.push({
        code: 'RUN_ARTIFACT_PATH_EMPTY',
        severity: 'error',
        file: 'README.md',
        field: 'section.Artifacts',
        message: 'an Artifacts entry has an empty path',
      })
    }
  }

  return diagnostics
}

// ---------- helpers ----------

function fromParseIssue(
  issue: ParseIssue,
  severity?: RunLintDiagnostic['severity'],
): RunLintDiagnostic {
  // Parser messages are `CODE: text` when they carry a stable code.
  const match = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(issue.message)
  return {
    code: match ? match[1]! : 'RUN_PARSE_ISSUE',
    severity: severity ?? issue.severity,
    file: 'README.md',
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: match ? match[2]! : issue.message,
  }
}

/**
 * FS v8 nesting check for `memon run lint`: every Run-shaped direct child
 * directory of the linted Run is reported as `RUN_NESTED` (Run directories
 * do not nest; the walk never lists a Run's contents, so such a child is
 * invisible to every list).
 */
export async function lintRunNesting(runDir: string): Promise<RunLintDiagnostic[]> {
  let entries: Dirent[]
  try {
    entries = await projectFs.readdir(runDir, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && RUN_DIR_REGEX.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      code: 'RUN_NESTED',
      severity: 'error' as const,
      file: name,
      message: `directory ${name} inside this Run is Run-shaped; Run directories do not nest and nested Runs are never discovered`,
    }))
}
