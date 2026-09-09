// Generic in-memory cache for "watch a directory, list its matching files,
// keep the per-file metadata around". Companion to FileCache.
//
// Where FileCache watches a fixed list of paths and cares about content,
// DirCache watches a directory and cares about WHICH files exist (plus
// per-file metadata for the rendered list — id, slug, title, mtime). Content
// of individual files is NOT held in memory by default; it is fetched on
// demand by `getContent(absPath)` so a project with thousands of reports
// doesn't pin all their bodies in memory.
//
// Used for:
//   - <projectRoot>/docs/reports/  (filenames R<NNNN>-<slug>.md)
//   - <projectRoot>/docs/wiki/     (depth 2: <kind>/<slug>.md and
//     <kind>/<slug>/README.md; opt in with `depth: 2`)
// Lifecycle (per instance):
//   1. ctor with one or more directories + filename regex + parse callback
//   2. await warmup(): scandir each dir, parse the matching files' bodies once
//      to extract metadata (title etc.) and register every matching path
//      with the shared Poller. The DIRECTORY itself is also registered, so
//      file additions/deletions are observed via the dir's mtime advance.
//   3. callers read via getList(dir) (metadata) or getContent(absPath)
//      (content+mtime+hash; hits the FS but is cheap).
//   4. on Poller tick:
//      - dir-mtime advance → re-scandir, diff against pathSet, parse
//        new entries, drop removed entries, update the list. New paths
//        are registered with the Poller.
//      - file-mtime advance → refresh that single entry's metadata.
//
// Writes (PUT /api/reports/[id], etc.) call `putContent` which performs an
// atomic-rename write with sha1 + mtime optimistic locking, then updates
// the cache entry with the post-write metadata.

import { createHash } from 'node:crypto'
import { type Dirent, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Poller } from '@memon/core'

export interface DirCacheEntry<T> {
  /** Parsed metadata. */
  meta: T
  /** Latest observed mtime of the file in epoch ms. */
  mtime: number
}

export interface DirCacheOptions<T> {
  /** Human-readable name (logging only). */
  name: string
  /** Absolute directory paths to watch. */
  dirs: string[]
  /** Filename regex; only files matching this are surfaced. */
  fileNameRegex: RegExp
  /**
   * Parse a file's bytes into the per-entry metadata object. Called during
   * warmup and on file-mtime change. Receives the absolute path, UTF-8
   * content, and the file's mtime (epoch ms) — typically the metadata type
   * includes an `mtime` field that the callback writes from this argument.
   * May be async when the metadata needs more of the filesystem (a bundle
   * asset listing, say).
   */
  parseFile: (absPath: string, content: string, mtime: number) => T | Promise<T>
  /** Optional callback after a successful list-level change (add / remove / update). */
  onUpdate?: (dir: string) => void
  /**
   * Directory nesting under each entry of `dirs`. `1` (the default) lists
   * matching files directly inside the configured directories. `2` treats the
   * configured directories as roots whose *subdirectories* hold the content
   * files, so a subdirectory appearing or disappearing is picked up from the
   * root's mtime and each subdirectory is watched in its own right.
   */
  depth?: 1 | 2
  /**
   * Depth-2 only: a subdirectory entry whose name matches this regex and that
   * contains `bundleFileName` counts as one content file (`<name>/README.md`).
   * Without it only plain files are surfaced.
   */
  bundleDirNameRegex?: RegExp
  /** Depth-2 only: the file inside a bundle directory that carries the body. */
  bundleFileName?: string
}

interface DirState<T> {
  /** Map: absPath → entry. */
  byPath: Map<string, DirCacheEntry<T>>
  /** Latest observed dir mtime — advances when files added/removed. */
  dirMtime: number
  /**
   * Depth-2 roots hold no files of their own; they own the set of content
   * subdirectories instead.
   */
  root: boolean
}

export interface PutContentResult {
  /** ok: true → write succeeded; payload mtime/hash reflect post-write state. */
  ok: true
  mtime: number
  hash: string
}

export interface PutContentConflict {
  ok: false
  /** 'CONFLICT' or 'NOT_FOUND' or 'ERROR'. */
  code: 'CONFLICT' | 'NOT_FOUND' | 'ERROR'
  /** Current on-disk mtime (when known). */
  currentMtime?: number
  /** Current on-disk hash (when known). */
  currentHash?: string
  /** Current on-disk content (when known and useful). */
  currentContent?: string
  /** Free-form error message for non-CONFLICT cases. */
  message?: string
}

export class DirCache<T> {
  private readonly state = new Map<string, DirState<T>>()
  private readonly knownPaths = new Set<string>()
  private readonly knownDirs: Set<string>
  /**
   * absPath → the watched directory that lists it. Not derivable from
   * `dirname` in depth-2 mode, where a bundle's `README.md` is listed by its
   * grandparent kind directory.
   */
  private readonly pathToDir = new Map<string, string>()
  private readonly depth: 1 | 2

  constructor(private readonly opts: DirCacheOptions<T>) {
    this.depth = opts.depth ?? 1
    this.knownDirs = new Set(opts.dirs)
    for (const d of opts.dirs) {
      this.state.set(d, { byPath: new Map(), dirMtime: 0, root: this.depth === 2 })
    }
  }

  /**
   * Initial scan of every configured directory. Missing dirs are tolerated
   * (treated as empty). After warmup the caller should register every path
   * in `paths()` AND every dir in `dirs()` with the shared Poller.
   */
  async warmup(): Promise<void> {
    await Promise.all(this.opts.dirs.map((d) => this.scanDir(d)))
  }

  /** All file paths currently known to the cache, across all dirs. */
  paths(): string[] {
    return Array.from(this.knownPaths)
  }

  /** All directory paths registered. */
  dirs(): string[] {
    return Array.from(this.knownDirs)
  }

  /**
   * Register, scan, and watch a new content directory at runtime. Used for the
   * dynamic set of docs/experiments/E-slug/code-review/ dirs, which appear and
   * disappear as experiments are created. Missing dirs are tolerated (treated
   * as empty until they appear; the Poller detects their creation). No-op if
   * the dir is already known.
   */
  async addDir(dir: string, poller?: Poller): Promise<void> {
    if (this.knownDirs.has(dir)) return
    this.knownDirs.add(dir)
    this.state.set(dir, { byPath: new Map(), dirMtime: 0, root: false })
    await this.scanDir(dir, poller)
    if (poller) {
      const st = this.state.get(dir)
      poller.watch(dir, st?.dirMtime ?? 0)
    }
  }

  /**
   * Drop a content directory and its entries from the cache. Stale Poller
   * watches on the removed dir's files are harmless (they ENOENT like any
   * deleted file), matching how scanDir handles a vanished directory.
   */
  removeDir(dir: string): void {
    const st = this.state.get(dir)
    if (st) {
      for (const p of st.byPath.keys()) {
        this.knownPaths.delete(p)
        this.pathToDir.delete(p)
      }
      this.state.delete(dir)
    }
    this.knownDirs.delete(dir)
  }

  /** All entries across every watched directory (for cross-dir aggregation). */
  getAllList(): T[] {
    const out: T[] = []
    for (const st of this.state.values()) {
      for (const e of st.byPath.values()) out.push(e.meta)
    }
    return out
  }

  /** List metadata for one watched directory. */
  getList(dir: string): T[] {
    const st = this.state.get(dir)
    if (!st) return []
    return Array.from(st.byPath.values()).map((e) => e.meta)
  }

  /**
   * Fresh content + mtime + hash for a single file. Always hits the FS so
   * the caller gets the bytes that match the returned mtime exactly. Returns
   * null on ENOENT.
   */
  async getContent(
    absPath: string,
  ): Promise<{ content: string; mtime: number; hash: string } | null> {
    try {
      const stat = await fs.stat(absPath)
      const content = await fs.readFile(absPath, 'utf8')
      const hash = sha1(content)
      return { content, mtime: stat.mtimeMs, hash }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  /**
   * Atomic write with mtime+hash optimistic locking. The caller passes the
   * mtime+hash they last observed; the server re-stats, re-hashes, compares,
   * and either writes through `<absPath>.tmp.<rand>` + rename, or returns a
   * CONFLICT with the current state. On success the cache entry's mtime and
   * the metadata are refreshed in place (metadata via re-parse from the new
   * content).
   */
  async putContent(
    absPath: string,
    content: string,
    expectedMtime: number,
    expectedHash: string,
  ): Promise<PutContentResult | PutContentConflict> {
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(absPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, code: 'NOT_FOUND' }
      }
      return { ok: false, code: 'ERROR', message: (err as Error).message }
    }

    if (stat.mtimeMs !== expectedMtime) {
      const cur = await this.getContent(absPath)
      return {
        ok: false,
        code: 'CONFLICT',
        currentMtime: cur?.mtime,
        currentHash: cur?.hash,
        currentContent: cur?.content,
      }
    }

    const onDisk = await fs.readFile(absPath, 'utf8')
    const onDiskHash = sha1(onDisk)
    if (onDiskHash !== expectedHash) {
      return {
        ok: false,
        code: 'CONFLICT',
        currentMtime: stat.mtimeMs,
        currentHash: onDiskHash,
        currentContent: onDisk,
      }
    }

    const tmp = `${absPath}.tmp.${Math.random().toString(36).slice(2)}`
    try {
      await fs.writeFile(tmp, content, 'utf8')
      await fs.rename(tmp, absPath)
    } catch (err) {
      try {
        await fs.unlink(tmp)
      } catch {
        /* ignore cleanup */
      }
      return { ok: false, code: 'ERROR', message: (err as Error).message }
    }

    const newStat = await fs.stat(absPath)
    const newMtime = newStat.mtimeMs
    const newHash = sha1(content)

    // Update cache entry in place.
    const dir = this.pathToDir.get(absPath)
    const st = dir ? this.state.get(dir) : undefined
    if (dir && st) {
      const meta = await this.opts.parseFile(absPath, content, newMtime)
      st.byPath.set(absPath, { meta, mtime: newMtime })
      this.opts.onUpdate?.(dir)
    }

    return { ok: true, mtime: newMtime, hash: newHash }
  }

  /**
   * Called by the shared Poller for any path that advanced. Returns true iff
   * this cache claims the path (so the caller can stop dispatching to other
   * caches). Handles three cases:
   *   - path is a directory we watch → re-scan it (diff add/remove)
   *   - path is a file we already know → refresh that entry
   *   - path is something we don't know → return false
   *
   * Newly-discovered files inside a watched dir are registered with the
   * caller-provided poller so subsequent edits are observed without restart.
   */
  handlePollChange(path: string, poller?: Poller): boolean {
    if (this.knownDirs.has(path)) {
      void this.scanDir(path, poller)
      return true
    }
    if (this.knownPaths.has(path)) {
      void this.refreshFile(path)
      return true
    }
    return false
  }

  /**
   * Internal: scan one directory and reconcile cache state against disk.
   * Missing dirs are tolerated.
   */
  private async scanDir(dir: string, poller?: Poller): Promise<void> {
    const st = this.state.get(dir)
    if (!st) return
    let entries: Dirent[]
    let dirMtime = 0
    try {
      const dirStat = await fs.stat(dir)
      dirMtime = dirStat.mtimeMs
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Wipe state for an absent dir.
        for (const p of st.byPath.keys()) {
          this.knownPaths.delete(p)
          this.pathToDir.delete(p)
        }
        st.byPath.clear()
        st.dirMtime = 0
        if (st.root) this.dropContentDirs(dir, new Set())
        return
      }
      throw err
    }

    if (st.root) {
      // Depth-2 root: the content directories are its children. Their own
      // scans (below, via addDir) surface the files.
      const children = new Set(
        entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name)),
      )
      this.dropContentDirs(dir, children)
      for (const child of children) {
        await this.addDir(child, poller)
      }
      st.dirMtime = dirMtime
      this.opts.onUpdate?.(dir)
      return
    }

    const matchedAbs = new Set<string>()
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const { bundleDirNameRegex, bundleFileName } = this.opts
        if (this.depth === 2 && bundleDirNameRegex?.test(entry.name) && bundleFileName) {
          matchedAbs.add(join(dir, entry.name, bundleFileName))
        }
        continue
      }
      if (this.opts.fileNameRegex.test(entry.name)) matchedAbs.add(join(dir, entry.name))
    }

    // Removals: paths in cache but not on disk.
    for (const p of Array.from(st.byPath.keys())) {
      if (!matchedAbs.has(p)) {
        st.byPath.delete(p)
        this.knownPaths.delete(p)
        this.pathToDir.delete(p)
      }
    }

    // Additions + refreshes: every matched path gets parsed.
    for (const absPath of matchedAbs) {
      try {
        const stat = await fs.stat(absPath)
        const content = await fs.readFile(absPath, 'utf8')
        const meta = await this.opts.parseFile(absPath, content, stat.mtimeMs)
        st.byPath.set(absPath, { meta, mtime: stat.mtimeMs })
        this.pathToDir.set(absPath, dir)
        if (!this.knownPaths.has(absPath)) {
          this.knownPaths.add(absPath)
          if (poller) poller.watch(absPath, stat.mtimeMs)
        }
      } catch {
        // Skip unreadable file; will retry on next dir poll.
      }
    }

    st.dirMtime = dirMtime
    this.opts.onUpdate?.(dir)
  }

  /** Internal: forget every content directory of `root` outside `keep`. */
  private dropContentDirs(root: string, keep: ReadonlySet<string>): void {
    const prefix = `${root}/`
    for (const known of Array.from(this.knownDirs)) {
      if (!known.startsWith(prefix)) continue
      if (known.slice(prefix.length).includes('/')) continue
      if (!keep.has(known)) this.removeDir(known)
    }
  }

  /** Internal: refresh metadata for a known file. */
  private async refreshFile(absPath: string): Promise<void> {
    const dir = this.pathToDir.get(absPath)
    const st = dir ? this.state.get(dir) : undefined
    if (!dir || !st) return
    try {
      const stat = await fs.stat(absPath)
      const content = await fs.readFile(absPath, 'utf8')
      const meta = await this.opts.parseFile(absPath, content, stat.mtimeMs)
      st.byPath.set(absPath, { meta, mtime: stat.mtimeMs })
      this.opts.onUpdate?.(dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        st.byPath.delete(absPath)
        this.knownPaths.delete(absPath)
        this.pathToDir.delete(absPath)
        this.opts.onUpdate?.(dir)
      }
    }
  }
}

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}
