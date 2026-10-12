import { dirname, isFileURI, join, relative } from '@memon/file-protocol/paths'
import { atomicTempPath } from '../atomic-write.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { projectFs } from '../project-file-store.js'
import {
  parseExperimentDescription,
  serializeExperimentDescription,
} from '../results/description.js'
import { enrollResearchRun, type ResearchLock, type ResearchTarget } from '../results/research.js'
import {
  assertDocumentLock,
  MutationError,
  type MutationFs,
  readDocumentState,
} from './mutations.js'

/** Called only while exclusively recording a new execution, before membership publication. */
export async function enrollCreatedResearchRun(
  fs: MutationFs,
  target: ResearchTarget,
  input: ResearchLock & { run: string; expectedVersion: number },
): Promise<void> {
  return withFileWriterLock(target.projectRoot, async () => {
    if (
      !input.run.startsWith('logs/') &&
      !input.run.startsWith('outputs/') &&
      !input.run.startsWith('experiments/')
    )
      throw new MutationError('BAD_REQUEST', 'Expected a project-relative Run path')
    if (input.run.split('/').some((part) => part === '..' || part === '.'))
      throw new MutationError('BAD_REQUEST', 'Invalid Run path')
    for (const name of ['README.md', 'result.csv']) {
      try {
        await fs.stat(join(target.projectRoot, input.run, name))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      throw new MutationError(
        'CONFLICT',
        'An existing recorded execution requires historical import, not current enrollment',
      )
    }
    const path = join(dirname(target.readmePath), 'experiment.json')
    if (!isFileURI(target.projectRoot)) {
      const root = await projectFs.realpath(target.projectRoot)
      for (const candidate of [path, target.readmePath, join(target.projectRoot, input.run)]) {
        const resolved = await projectFs.realpath(candidate)
        const rel = relative(root, resolved)
        if (!rel || rel.startsWith('..') || rel.startsWith('/'))
          throw new MutationError('FORBIDDEN', 'Research enrollment path escapes the project')
      }
    }
    const before = await readDocumentState(fs, path)
    assertDocumentLock(before, input)
    const description = parseExperimentDescription(before.content).data
    if (!description) throw new MutationError('BAD_STATE', 'Invalid experiment.json')
    const next = enrollResearchRun(
      description,
      input.run,
      input.expectedVersion,
      'New execution recorded',
      'created',
      input.now,
    )
    const content = serializeExperimentDescription(next)
    assertDocumentLock(await readDocumentState(fs, path), input)
    const temp = atomicTempPath(path)
    try {
      await fs.writeFile(temp, content, { encoding: 'utf8', mode: (await fs.stat(path)).mode })
      await fs.rename(temp, path)
    } finally {
      await fs.rm(temp, { force: true })
    }
  })
}
