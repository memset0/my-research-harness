// Lint of a complete FS v9 Experiment bundle: the README and managed sources
// (`lintExperimentDocument`) plus every declared member's `result.csv` —
// version agreement, duplicate pairs, declared types, cross-file conflicts —
// and, inside a Git work tree, `RESULT_FILE_IGNORED` for an existing member
// result file that the ignore rules exclude.

import { join } from 'node:path'
import {
  type ExperimentDocumentDiagnostic,
  type LintExperimentDocumentOptions,
  lintExperimentDocument,
} from '../experiments/documents.js'
import { isRunPath } from '../ids.js'
import { projectFs as fs } from '../project-file-store.js'
import type { Experiment } from '../types.js'
import type { ResultsDiagnostic } from './diagnostics.js'
import { type CheckIgnore, planResultAllowRules, RESULT_FILE_IGNORED } from './ignore.js'
import { type ParsedResultFile, parseResultFile, RESULT_FILE_NAME } from './result-file.js'

export interface MemberResultFile {
  /** Project-relative Run path. */
  run: string
  parsed: ParsedResultFile
}

/** Read and parse the `result.csv` of every declared member that has one. */
export async function readMemberResultFiles(
  projectRoot: string,
  runs: readonly string[],
): Promise<MemberResultFile[]> {
  const files: MemberResultFile[] = []
  for (const run of [...new Set(runs)].filter((reference) => isRunPath(reference))) {
    let content: string
    try {
      content = await fs.readFile(join(projectRoot, ...run.split('/'), RESULT_FILE_NAME), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    files.push({ run, parsed: parseResultFile(content, `${run}/${RESULT_FILE_NAME}`) })
  }
  return files
}

/** `RESULT_FILE_IGNORED` warnings for existing member result files (none outside Git). */
export async function ignoredMemberResultFiles(
  projectRoot: string,
  runs: readonly string[],
  options: { runDirs?: readonly string[]; checkIgnore?: CheckIgnore } = {},
): Promise<ResultsDiagnostic[]> {
  if (runs.length === 0) return []
  const plan = await planResultAllowRules({
    projectRoot,
    runs,
    ...(options.runDirs ? { runDirs: options.runDirs } : {}),
    ...(options.checkIgnore ? { checkIgnore: options.checkIgnore } : {}),
  }).catch(() => null)
  if (!plan) return []
  return plan.ignored.map((entry) => {
    const target = plan.targets.find((candidate) => candidate.file === entry.target)
    return {
      code: RESULT_FILE_IGNORED,
      severity: 'warning' as const,
      file: entry.file,
      message: `${entry.file} is ignored by ${entry.rule}; Git will not track it. Append the allow rules to ${entry.target} and commit: ${target?.command ?? ''}`,
    }
  })
}

export interface LintExperimentBundleOptions extends LintExperimentDocumentOptions {
  /** Check existing member result files with `git check-ignore` (default true). */
  checkIgnore?: boolean
  gitCheckIgnore?: CheckIgnore
}

/** The complete FS v9 lint of one Experiment, member result files included. */
export async function lintExperimentBundle(
  projectRoot: string,
  experiment: Experiment,
  options: LintExperimentBundleOptions = {},
): Promise<ExperimentDocumentDiagnostic[]> {
  const resultFiles = await readMemberResultFiles(projectRoot, experiment.frontMatter.runs)
  const ignoredResultFiles =
    options.checkIgnore === false
      ? []
      : await ignoredMemberResultFiles(
          projectRoot,
          resultFiles.map((file) => file.run),
          {
            ...(options.runDirs ? { runDirs: options.runDirs } : {}),
            ...(options.gitCheckIgnore ? { checkIgnore: options.gitCheckIgnore } : {}),
          },
        )
  return lintExperimentDocument(experiment, { ...options, resultFiles, ignoredResultFiles })
}
