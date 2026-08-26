// @vitest-environment node

import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('central Host qualification static audit', () => {
  it('rejects known name-only resource fetch and cache patterns in Experiment detail surfaces', async () => {
    const files = [
      join(WEB, 'components/experiment-page.tsx'),
      join(WEB, 'components/experiment-detail.tsx'),
      join(WEB, 'components/readme-editor.tsx'),
      join(WEB, 'components/archive-toggle.tsx'),
      join(WEB, 'components/status-edit.tsx'),
      join(WEB, 'components/experiment-status-edit.tsx'),
      join(WEB, 'components/warnings-card.tsx'),
      join(WEB, 'components/inbox-shell.tsx'),
      join(WEB, 'components/report-pane.tsx'),
      join(WEB, 'components/log-viewer.tsx'),
    ]
    const forbidden = [
      /queryKey:\s*\[['"](?:run|run-files|experiment)['"],\s*(?:runId|experimentId|id|expId)\]/,
      /fetchExperimentDoc\(experimentId\)/,
      /fetchExperiment\(runId\)/,
      /fetchRunFiles\(runId/,
      /fetchExperimentResults\(experimentId\)/,
      /memon:exp-page:\$\{experimentId\}/,
      /fetchLog\(path\s*,/,
      /fetchLogFiles\(expPath\)/,
      /new EventSource\(`\/api\/log\/stream\?\$\{params/,
    ]
    const violations: string[] = []
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      for (const pattern of forbidden)
        if (pattern.test(source)) violations.push(`${file}:${pattern}`)
    }
    expect(violations).toEqual([])
  })

  it('requires Host-qualified resource helpers while retaining explicit standalone fallback', async () => {
    const api = await fs.readFile(join(WEB, 'lib/api.ts'), 'utf8')
    for (const name of [
      'fetchExperiment',
      'fetchExperimentDoc',
      'fetchExperimentResults',
      'fetchRunFiles',
      'fetchWarnings',
      'fetchLog',
      'fetchLogFiles',
    ]) {
      expect(api).toMatch(new RegExp(`function ${name}\\([\\s\\S]{0,100}ProjectTarget`))
    }
    expect(api).toContain('function projectResourceUrl')
    expect(api).toContain('return target ? projectQueryUrl(path, target) : path')
  })
})
