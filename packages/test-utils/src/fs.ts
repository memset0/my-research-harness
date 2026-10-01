import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const trackedDirs = new Set<string>()

/**
 * Create a fresh directory under the OS temp dir. It is tracked so that one
 * `removeTempDirs()` in `afterEach`/`afterAll` deletes every directory made
 * since the previous call.
 */
export async function makeTempDir(prefix = 'memon-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  trackedDirs.add(dir)
  return dir
}

/** Remove every directory created through `makeTempDir`/`createTempProject`. */
export async function removeTempDirs(): Promise<void> {
  const dirs = [...trackedDirs]
  trackedDirs.clear()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
}

/** A file's content, or a map of bundle-relative path → content. */
export type FixtureEntry = string | Record<string, string>

export interface TempProjectSpec {
  /** Run directory (relative to the project root) → README.md content or file map. */
  runs?: Record<string, FixtureEntry>
  /** `E<NNNN>-<slug>` → README.md content or bundle file map, under `docs/experiments/`. */
  experiments?: Record<string, FixtureEntry>
  /** Path under `docs/wiki/` (for example `finding/W0001-x.md`) → page content. */
  wiki?: Record<string, string>
  /** Any other project-relative path → content. */
  files?: Record<string, string>
  /** `mkdtemp` prefix. */
  prefix?: string
}

export interface TempProject {
  root: string
  /** Absolute path of a project-relative location. */
  path(...segments: string[]): string
  /** Remove this project now (it is also removed by `removeTempDirs`). */
  cleanup(): Promise<void>
}

async function writeFixture(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

async function writeEntry(dir: string, entry: FixtureEntry): Promise<void> {
  if (typeof entry === 'string') {
    await writeFixture(join(dir, 'README.md'), entry)
    return
  }
  for (const [name, content] of Object.entries(entry)) await writeFixture(join(dir, name), content)
}

/** Create a temporary memon project root populated with the given fixtures. */
export async function createTempProject(spec: TempProjectSpec = {}): Promise<TempProject> {
  const root = await makeTempDir(spec.prefix ?? 'memon-project-')
  for (const [runDir, entry] of Object.entries(spec.runs ?? {})) {
    await writeEntry(join(root, runDir), entry)
  }
  for (const [id, entry] of Object.entries(spec.experiments ?? {})) {
    await writeEntry(join(root, 'docs', 'experiments', id), entry)
  }
  for (const [page, content] of Object.entries(spec.wiki ?? {})) {
    await writeFixture(join(root, 'docs', 'wiki', page), content)
  }
  for (const [file, content] of Object.entries(spec.files ?? {})) {
    await writeFixture(join(root, file), content)
  }
  return {
    root,
    path: (...segments) => join(root, ...segments),
    cleanup: async () => {
      trackedDirs.delete(root)
      await rm(root, { recursive: true, force: true })
    },
  }
}
