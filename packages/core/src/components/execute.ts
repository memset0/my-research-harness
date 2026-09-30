// Executable component payloads: run one Python function per block and cache
// its returned object beside the document.
//
// The contract with the project's code is deliberately narrow. A block names
// either a `script: <path>::<function>` (resolved against the document's own
// directory, or absolute, and required to sit inside the project root) or an
// inline `code:` body with one `def`. The function is called with the block's
// remaining keys as keyword arguments plus the injected `__id`,
// `__md_file_path`, `__project_root`, and `__assets_dir`, from the project
// root, under a timeout, and must return a JSON object. Nothing here
// sandboxes the interpreter: the same trust level as running the project's
// own entry point.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { COMPONENT_LATEST_VERSION } from '../wiki/component-names.generated.js'
import { parseWikiComponentBlocks } from '../wiki/components.js'
import { canonicalJson, componentAssetsDir, writeComponentCache } from './cache.js'
import { derivePayload, type ExecutableSpec, executableFunctionName } from './payload.js'

export const COMPONENT_RUN_DEFAULT_PYTHON = 'python3'
export const COMPONENT_RUN_DEFAULT_TIMEOUT_MS = 120_000
/** Marker the bootstrap prints before the JSON result. */
const RESULT_SENTINEL = '@@MEMON_RESULT@@'
/** How much of a failing run's stderr is quoted in the error message. */
const STDERR_TAIL_CHARS = 2000
/** Runaway-output guard; a component returns a payload, not a log stream. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Loads the block's module by file path (never by package name), calls the
 * named function, and frames the JSON result on stdout so anything the
 * project's own code prints stays harmless.
 */
const BOOTSTRAP = `import importlib.util, json, os, sys

module_path = os.environ["MEMON_COMPONENT_MODULE"]
function_name = os.environ["MEMON_COMPONENT_FUNCTION"]
kwargs = json.loads(os.environ["MEMON_COMPONENT_KWARGS"])
spec = importlib.util.spec_from_file_location("_memon_component", module_path)
if spec is None or spec.loader is None:
    raise ImportError("cannot load %s" % module_path)
module = importlib.util.module_from_spec(spec)
sys.modules["_memon_component"] = module
sys.path.insert(0, os.path.dirname(module_path))
spec.loader.exec_module(module)
if not hasattr(module, function_name):
    raise AttributeError("%s does not define %s" % (module_path, function_name))
result = getattr(module, function_name)(**kwargs)
sys.stdout.write("\\n${RESULT_SENTINEL}\\n")
sys.stdout.write(json.dumps(result))
sys.stdout.flush()
`

export type ComponentRunErrorCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'UNKNOWN_ID'
  | 'NO_EXECUTABLE_BLOCKS'
  | 'INVALID_BLOCK'

/** A request the runner refuses outright; per-block failures are results. */
export class ComponentRunError extends Error {
  readonly code: ComponentRunErrorCode
  /** Executable block ids of the document, for `UNKNOWN_ID`. */
  readonly ids?: string[]

  constructor(code: ComponentRunErrorCode, message: string, ids?: string[]) {
    super(message)
    this.name = 'ComponentRunError'
    this.code = code
    if (ids !== undefined) this.ids = ids
  }
}

export interface ExecutableComponentBlock {
  /** Null only in a malformed document; a cached block needs an id. */
  id: string | null
  type: string
  version: number | null
  /** 1-based line of the opening fence in the given Markdown. */
  line: number
  spec: ExecutableSpec
}

export interface ComponentRunRequest {
  /** Absolute project root. */
  root: string
  /** Project-relative document path. */
  documentPath: string
  /** Interpreter to spawn; defaults to `python3`. */
  pythonCommand?: string
  timeoutMs?: number
  /** Restrict the run to these block ids; omit to run every one. */
  ids?: readonly string[]
}

export interface ComponentRunResult {
  id: string
  status: 'updated' | 'unchanged' | 'failed'
  /** Project-relative cache file path. */
  path: string
  durationMs: number
  error?: string
}

/** Every executable component block of a Markdown document, in body order. */
export function listExecutableComponentBlocks(markdown: string): ExecutableComponentBlock[] {
  const blocks: ExecutableComponentBlock[] = []
  for (const block of parseWikiComponentBlocks(markdown)) {
    if (!block.executable) continue
    const payload = derivePayload(block.lang, block.payload)
    if (payload.kind !== 'executable') continue
    blocks.push({
      id: block.id,
      type: block.type,
      version: block.version,
      line: block.line,
      spec: payload.spec,
    })
  }
  return blocks
}

/**
 * Run the document's executable blocks sequentially — component functions
 * read the project's own outputs, and a parallel run would make the machine's
 * load, not the document, decide how long each one takes.
 */
export async function runDocumentComponents(
  request: ComponentRunRequest,
): Promise<ComponentRunResult[]> {
  const root = await fs.realpath(resolve(request.root))
  const documentPath = request.documentPath.replace(/\\/g, '/')
  const absoluteDocument = resolve(root, documentPath)

  let content: string
  try {
    content = await fs.readFile(absoluteDocument, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      throw new ComponentRunError('DOCUMENT_NOT_FOUND', `document not found: ${documentPath}`)
    }
    throw err
  }

  const blocks = listExecutableComponentBlocks(content)
  const anonymous = blocks.filter((block) => block.id === null)
  if (anonymous.length > 0) {
    throw new ComponentRunError(
      'INVALID_BLOCK',
      `executable block needs #<id>: ${documentPath} line ${anonymous.map((block) => block.line).join(', ')}`,
    )
  }
  const ids = blocks.map((block) => block.id!)
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicates.length > 0) {
    throw new ComponentRunError(
      'INVALID_BLOCK',
      `duplicate executable block id(s) in ${documentPath}: ${duplicates.join(', ')}`,
      ids,
    )
  }

  let selected = blocks
  if (request.ids !== undefined && request.ids.length > 0) {
    if (blocks.length === 0) {
      throw new ComponentRunError(
        'NO_EXECUTABLE_BLOCKS',
        `${documentPath} has no executable component blocks`,
      )
    }
    const unknown = request.ids.filter((id) => !ids.includes(id))
    if (unknown.length > 0) {
      throw new ComponentRunError(
        'UNKNOWN_ID',
        `no executable component block with id ${unknown.join(', ')} in ${documentPath}`,
        ids,
      )
    }
    selected = request.ids.map((id) => blocks.find((block) => block.id === id)!)
  }

  const python = request.pythonCommand ?? COMPONENT_RUN_DEFAULT_PYTHON
  const timeoutMs = request.timeoutMs ?? COMPONENT_RUN_DEFAULT_TIMEOUT_MS
  const results: ComponentRunResult[] = []
  for (const block of selected) {
    results.push(await runBlock({ root, documentPath, absoluteDocument, block, python, timeoutMs }))
  }
  return results
}

interface RunBlockInput {
  root: string
  documentPath: string
  absoluteDocument: string
  block: ExecutableComponentBlock
  python: string
  timeoutMs: number
}

async function runBlock(input: RunBlockInput): Promise<ComponentRunResult> {
  const { block, root, documentPath } = input
  const id = block.id!
  const version = block.version ?? COMPONENT_LATEST_VERSION[block.type] ?? 1
  const componentType = `${block.type}@${version}`
  const started = Date.now()

  let module: { path: string; source: string; temporaryDir: string | null }
  try {
    module = await resolveModule(input)
  } catch (err) {
    return writeFailure({
      root,
      documentPath,
      id,
      componentType,
      sourceHash: '',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    })
  }

  try {
    const sourceHash = createHash('sha256')
      .update(module.source)
      .update('\n')
      .update(canonicalJson(block.spec.kwargs))
      .digest('hex')
    const kwargs = {
      ...block.spec.kwargs,
      __id: id,
      __md_file_path: documentPath,
      __project_root: root,
      __assets_dir: componentAssetsDir(documentPath),
    }
    const spawned = await spawnPython({
      python: input.python,
      timeoutMs: input.timeoutMs,
      cwd: root,
      modulePath: module.path,
      functionName: executableFunctionName(block.spec),
      kwargs,
    })
    const durationMs = Date.now() - started

    if (spawned.error !== null) {
      return writeFailure({
        root,
        documentPath,
        id,
        componentType,
        sourceHash,
        durationMs,
        error: spawned.error,
      })
    }
    const data = readResult(spawned.stdout)
    if (typeof data === 'string') {
      return writeFailure({
        root,
        documentPath,
        id,
        componentType,
        sourceHash,
        durationMs,
        error: withStderr(data, spawned.stderr),
      })
    }
    const written = await writeComponentCache({
      root,
      documentPath,
      id,
      componentType,
      sourceHash,
      durationMs,
      data,
    })
    return { id, status: written.status, path: written.path, durationMs }
  } finally {
    if (module.temporaryDir !== null)
      await fs.rm(module.temporaryDir, { recursive: true, force: true })
  }
}

/**
 * The file the interpreter loads: the referenced script (which must resolve
 * inside the project root) or a private temp copy of an inline `code` body.
 */
async function resolveModule(
  input: RunBlockInput,
): Promise<{ path: string; source: string; temporaryDir: string | null }> {
  const { spec } = input.block
  if (spec.script === undefined) {
    const temporaryDir = await fs.mkdtemp(join(tmpdir(), 'memon-component-'))
    const path = join(temporaryDir, 'component.py')
    await fs.writeFile(path, spec.code!, 'utf8')
    return { path, source: spec.code!, temporaryDir }
  }

  const reference = spec.script.slice(0, spec.script.lastIndexOf('::'))
  const candidate = isAbsolute(reference)
    ? reference
    : resolve(dirname(input.absoluteDocument), reference)
  let real: string
  try {
    real = await fs.realpath(candidate)
  } catch {
    throw new Error(`script not found: ${reference}`)
  }
  if (real !== input.root && !real.startsWith(`${input.root}${sep}`)) {
    throw new Error(`script path escapes the project root: ${reference}`)
  }
  return { path: real, source: await fs.readFile(real, 'utf8'), temporaryDir: null }
}

interface SpawnPythonInput {
  python: string
  timeoutMs: number
  cwd: string
  modulePath: string
  functionName: string
  kwargs: Record<string, unknown>
}

interface SpawnPythonResult {
  stdout: string
  stderr: string
  /** Non-null when the process itself failed (spawn, timeout, exit code). */
  error: string | null
}

function spawnPython(input: SpawnPythonInput): Promise<SpawnPythonResult> {
  return new Promise<SpawnPythonResult>((resolvePromise) => {
    const child = spawn(input.python, ['-c', BOOTSTRAP], {
      cwd: input.cwd,
      // Own process group, so a timeout kills the function's own children too.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MEMON_COMPONENT_MODULE: input.modulePath,
        MEMON_COMPONENT_FUNCTION: input.functionName,
        MEMON_COMPONENT_KWARGS: JSON.stringify(input.kwargs),
      },
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let overflow = false
    let timedOut = false

    const kill = (): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, input.timeoutMs)
    const finish = (result: SpawnPythonResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT_BYTES) {
        overflow = true
        kill()
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > MAX_OUTPUT_BYTES) {
        overflow = true
        kill()
      }
    })
    child.on('error', (err) => {
      finish({ stdout, stderr, error: `cannot run ${input.python}: ${err.message}` })
    })
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish({ stdout, stderr, error: `timed out after ${input.timeoutMs} ms` })
        return
      }
      if (overflow) {
        finish({
          stdout,
          stderr,
          error: `component produced more than ${MAX_OUTPUT_BYTES} bytes of output`,
        })
        return
      }
      if (code === 0) {
        finish({ stdout, stderr, error: null })
        return
      }
      const how = code === null ? `was killed by ${signal}` : `exited with code ${code}`
      finish({ stdout, stderr, error: withStderr(`${input.python} ${how}`, stderr) })
    })
  })
}

/** The result object, or a message describing why stdout carried none. */
function readResult(stdout: string): Record<string, unknown> | string {
  const marker = `\n${RESULT_SENTINEL}\n`
  const at = stdout.lastIndexOf(marker)
  if (at === -1) return 'component function printed no result marker'
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.slice(at + marker.length))
  } catch (err) {
    return `component result is not valid JSON: ${(err as Error).message}`
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `component function must return a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
  }
  return parsed as Record<string, unknown>
}

function withStderr(message: string, stderr: string): string {
  const tail = stderr.trim()
  if (tail === '') return message
  return `${message}: ${tail.slice(-STDERR_TAIL_CHARS)}`
}

async function writeFailure(input: {
  root: string
  documentPath: string
  id: string
  componentType: string
  sourceHash: string
  durationMs: number
  error: string
}): Promise<ComponentRunResult> {
  const written = await writeComponentCache(input)
  return {
    id: input.id,
    status: written.status,
    path: written.path,
    durationMs: input.durationMs,
    error: input.error,
  }
}
