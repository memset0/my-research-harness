// memon doctor — pure scan that flags experiments needing attention.

import { runDoctor, type IssueSeverity } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface DoctorInput {
  projectRoot?: string
  configPath?: string
  cwd: string
  format: OutputFormat
  includeArchived?: boolean
  severity?: IssueSeverity
}

export async function runDoctorCmd(input: DoctorInput): Promise<void> {
  const ctx = await resolveContext(input)
  const root = singleProjectRoot(ctx)
  const report = await runDoctor(root, {
    includeArchived: input.includeArchived,
    severity: input.severity,
  })

  if (input.format === 'human') {
    process.stdout.write(humanReport(report))
  } else {
    emitJson(report)
  }

  if (report.summary.bySeverity.error > 0) {
    process.exit(1)
  }
}

function humanReport(r: Awaited<ReturnType<typeof runDoctor>>): string {
  if (r.issues.length === 0) {
    return `no issues found in ${r.projectRoot}\n`
  }
  const lines: string[] = []
  lines.push(`${r.summary.total} issues in ${r.projectRoot}`)
  lines.push(
    `  by severity: error=${r.summary.bySeverity.error} warn=${r.summary.bySeverity.warn} info=${r.summary.bySeverity.info}`,
  )
  lines.push('')
  for (const i of r.issues) {
    lines.push(`[${i.severity.toUpperCase()}] ${i.experimentId}  ${i.code}`)
    lines.push(`    ${i.message}`)
    lines.push(`    → ${i.suggestedAction}`)
    lines.push('')
  }
  return lines.join('\n')
}
