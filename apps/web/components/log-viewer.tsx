'use client'

import Anser, { type AnserJsonEntry } from 'anser'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLog, fetchLogFiles, type LogFileEntry } from '../lib/api'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Input } from './ui/input'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { cn } from '../lib/utils'

const PAGE = 100
/** Distance (px) from the bottom that still counts as "at the bottom". */
const BOTTOM_EPSILON_PX = 50

interface Line {
  lineNumber: number
  text: string
}

interface SearchMatch {
  lineIndex: number // index into rendered `lines`
  start: number
  end: number
}

export function LogViewer({ expPath }: { expPath: string }) {
  const { data: filesData } = useQuery({
    queryKey: ['log-files', expPath],
    queryFn: () => fetchLogFiles(expPath),
    staleTime: 30_000,
  })
  const files: LogFileEntry[] = filesData?.files ?? []

  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    if (selectedPath) return
    if (files.length > 0) setSelectedPath(files[0]!.path)
  }, [files, selectedPath])

  if (files.length === 0 && filesData) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground italic py-6">
          No log-shaped files (.log / .txt / .out / .err) found in this experiment directory.
        </CardContent>
      </Card>
    )
  }

  if (!selectedPath) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground py-6">loading…</CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="border-b p-2">
        <Tabs value={selectedPath} onValueChange={setSelectedPath}>
          <TabsList>
            {files.map((f) => (
              <TabsTrigger key={f.path} value={f.path} className="font-mono text-xs">
                {f.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="p-3">
        <FileViewer key={selectedPath} path={selectedPath} />
      </CardContent>
    </Card>
  )
}

// ---------- Single-file viewer (one tab) ----------

function FileViewer({ path }: { path: string }) {
  const [lines, setLines] = useState<Line[]>([])
  const [totalLines, setTotalLines] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingNew, setPendingNew] = useState(0)

  const [query, setQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [selectAnchor, setSelectAnchor] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(follow)
  followRef.current = follow

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchLog(path, { count: PAGE })
      setLines(r.lines)
      setTotalLines(r.totalLines)
      setPendingNew(0)
    } catch (e) {
      setError((e as Error).message)
      setLines([])
      setTotalLines(0)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams({ path })
    const es = new EventSource(`/api/log/stream?${params.toString()}`)
    es.addEventListener('ready', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { totalLines: number }
        setTotalLines(data.totalLines)
      } catch {
        /* ignore */
      }
    })
    es.addEventListener('append', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { lines: Line[] }
        if (!data.lines || data.lines.length === 0) return
        setLines((cur) => [...cur, ...data.lines])
        setTotalLines((t) => (t ?? 0) + data.lines.length)
        if (!followRef.current) {
          setPendingNew((n) => n + data.lines.length)
        }
      } catch {
        /* ignore */
      }
    })
    es.addEventListener('rotated', () => {
      void loadInitial()
    })
    return () => {
      es.close()
    }
  }, [path, loadInitial])

  const linesLength = lines.length
  useEffect(() => {
    if (!follow) return
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [linesLength, follow])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < BOTTOM_EPSILON_PX
    setFollow((cur) => {
      if (cur && !atBottom) return false
      if (!cur && atBottom) {
        setPendingNew(0)
        return true
      }
      return cur
    })
  }, [])

  const onLoadEarlier = useCallback(async () => {
    if (lines.length === 0) return
    const minLine = lines[0]!.lineNumber
    if (minLine <= 1) return
    const target = Math.max(1, minLine - 1)
    try {
      const r = await fetchLog(path, { endLine: target, count: PAGE })
      setLines((cur) => [...r.lines, ...cur])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [lines, path])

  const jumpToTail = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollow(true)
    setPendingNew(0)
  }, [])

  // ---- search matches
  const matches = useMemo<SearchMatch[]>(() => {
    if (!query) return []
    const needle = query.toLowerCase()
    const out: SearchMatch[] = []
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!.text.toLowerCase()
      let idx = text.indexOf(needle)
      while (idx !== -1) {
        out.push({ lineIndex: i, start: idx, end: idx + needle.length })
        idx = text.indexOf(needle, idx + needle.length)
      }
    }
    return out
  }, [lines, query])

  useEffect(() => {
    if (matches.length === 0) {
      setCurrentMatchIndex(0)
      return
    }
    setCurrentMatchIndex((i) => Math.min(i, matches.length - 1))
  }, [matches.length])

  const scrollMatchIntoView = useCallback(
    (matchIdx: number) => {
      const m = matches[matchIdx]
      if (!m) return
      const lineEl = containerRef.current?.querySelector(
        `[data-line-num="${lines[m.lineIndex]?.lineNumber}"]`,
      )
      lineEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [matches, lines],
  )

  // ---- line selection + URL hash
  const setSelectionWithHash = useCallback(
    (sel: { start: number; end: number } | null) => {
      setSelection(sel)
      if (typeof window === 'undefined') return
      if (!sel) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
        return
      }
      const hash = sel.start === sel.end ? `#L${sel.start}` : `#L${sel.start}-L${sel.end}`
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search + hash,
      )
    },
    [],
  )

  const onLineNumberClick = (lineNumber: number, shiftKey: boolean) => {
    if (shiftKey && selectAnchor !== null) {
      const a = Math.min(selectAnchor, lineNumber)
      const b = Math.max(selectAnchor, lineNumber)
      setSelectionWithHash({ start: a, end: b })
    } else {
      setSelectAnchor(lineNumber)
      setSelectionWithHash({ start: lineNumber, end: lineNumber })
    }
  }

  // Read URL hash on mount
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash) return
    const m = /^#L(\d+)(?:-L(\d+))?$/.exec(hash)
    if (!m) return
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    setSelection({ start: a, end: b })
    setSelectAnchor(a)
  }, [path])

  // After lines load, scroll selection into view (and fetch around it if missing)
  useEffect(() => {
    if (!selection || lines.length === 0) return
    const inBuffer = lines.some((l) => l.lineNumber === selection.start)
    if (inBuffer) {
      const el = containerRef.current?.querySelector(`[data-line-num="${selection.start}"]`)
      el?.scrollIntoView({ block: 'center' })
      setFollow(false)
    } else if (totalLines !== null && selection.start <= totalLines) {
      void fetchLog(path, { endLine: selection.end + 50, count: 120 }).then((r) => {
        setLines((cur) => {
          const byNum = new Map<number, Line>()
          for (const l of cur) byNum.set(l.lineNumber, l)
          for (const l of r.lines) byNum.set(l.lineNumber, l)
          return Array.from(byNum.values()).sort((a, b) => a.lineNumber - b.lineNumber)
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.start, selection?.end, lines.length === 0])

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={loadInitial}>
            retry
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={lines.length === 0 || lines[0]!.lineNumber <= 1}
          onClick={onLoadEarlier}
        >
          ↑ load 100 earlier
        </Button>
        <div className="relative flex-1 min-w-[14rem] max-w-[28rem]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="search in log…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-7"
          />
        </div>
        {query && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <span className="font-mono">
              {matches.length === 0 ? '0 / 0' : `${currentMatchIndex + 1} / ${matches.length}`}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={matches.length === 0}
              onClick={() => {
                const next = (currentMatchIndex - 1 + matches.length) % matches.length
                setCurrentMatchIndex(next)
                scrollMatchIntoView(next)
              }}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={matches.length === 0}
              onClick={() => {
                const next = (currentMatchIndex + 1) % matches.length
                setCurrentMatchIndex(next)
                scrollMatchIntoView(next)
              }}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </div>
        )}
        {totalLines !== null && (
          <span className="text-muted-foreground">{totalLines.toLocaleString()} lines</span>
        )}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            follow
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {follow ? 'follow' : 'paused'}
        </span>
        <Button size="sm" variant="outline" onClick={loadInitial} disabled={loading}>
          {loading ? 'loading…' : 'reload'}
        </Button>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="max-h-[60vh] overflow-auto rounded-md border bg-zinc-950 p-2 font-mono text-xs leading-tight text-zinc-100"
        >
          {lines.length === 0 && !loading && (
            <div className="p-2 text-zinc-500">no lines (file empty or missing)</div>
          )}
          {lines.map((l, i) => {
            const sel =
              selection !== null &&
              l.lineNumber >= selection.start &&
              l.lineNumber <= selection.end
            const lineMatches = matches.filter((m) => m.lineIndex === i)
            return (
              <LogLine
                key={l.lineNumber}
                line={l}
                lineRowIndex={i}
                selected={sel}
                matches={lineMatches}
                currentMatchAbsoluteIndex={currentMatchIndex}
                allMatches={matches}
                onLineNumberClick={onLineNumberClick}
              />
            )
          })}
        </div>
        {pendingNew > 0 && !follow && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={jumpToTail}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          >
            {pendingNew} new line{pendingNew === 1 ? '' : 's'} ↓
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------- LogLine: ANSI parse + search highlight + line selection ----------

interface LogLineProps {
  line: Line
  lineRowIndex: number
  selected: boolean
  matches: SearchMatch[]
  currentMatchAbsoluteIndex: number
  allMatches: SearchMatch[]
  onLineNumberClick: (n: number, shift: boolean) => void
}

function LogLine({
  line,
  lineRowIndex,
  selected,
  matches,
  currentMatchAbsoluteIndex,
  allMatches,
  onLineNumberClick,
}: LogLineProps) {
  const ansiSegments: AnserJsonEntry[] = useMemo(
    () => Anser.ansiToJson(line.text, { json: true, use_classes: false }),
    [line.text],
  )

  // Walk the line in plain-text indices, splitting both by ANSI segments AND
  // search-match boundaries, so each rendered span has a uniform color +
  // match-state.
  const renderSegments = useMemo(() => {
    interface Segment {
      text: string
      ansi: AnserJsonEntry
      isMatch: boolean
      isCurrentMatch: boolean
    }
    const out: Segment[] = []
    let plainOffset = 0
    for (const a of ansiSegments) {
      const segLen = a.content.length
      if (segLen === 0) continue
      const segStart = plainOffset
      const segEnd = plainOffset + segLen
      const overlapping = matches.filter((m) => m.start < segEnd && m.end > segStart)
      const points = new Set<number>([segStart, segEnd])
      for (const m of overlapping) {
        if (m.start > segStart) points.add(m.start)
        if (m.end < segEnd) points.add(m.end)
      }
      const sorted = Array.from(points).sort((x, y) => x - y)
      for (let i = 0; i < sorted.length - 1; i++) {
        const ps = sorted[i]!
        const pe = sorted[i + 1]!
        const slice = a.content.slice(ps - segStart, pe - segStart)
        if (slice === '') continue
        const matchHere = overlapping.some((m) => m.start <= ps && m.end >= pe)
        const cm = allMatches[currentMatchAbsoluteIndex]
        const currentMatchHere =
          matchHere &&
          cm !== undefined &&
          cm.lineIndex === lineRowIndex &&
          cm.start <= ps &&
          cm.end >= pe
        out.push({ text: slice, ansi: a, isMatch: matchHere, isCurrentMatch: currentMatchHere })
      }
      plainOffset = segEnd
    }
    return out
  }, [ansiSegments, matches, allMatches, currentMatchAbsoluteIndex, lineRowIndex])

  return (
    <div
      data-line-num={line.lineNumber}
      className={cn(
        'grid grid-cols-[6ch_1fr] gap-2 border-l-2 border-transparent',
        selected && 'border-sky-400 bg-sky-500/10',
      )}
    >
      <button
        type="button"
        className="select-none text-right text-zinc-500 hover:text-zinc-300 cursor-pointer"
        onClick={(e) => onLineNumberClick(line.lineNumber, e.shiftKey)}
        title={`line ${line.lineNumber} (click to select, shift-click for range)`}
      >
        {line.lineNumber}
      </button>
      <span className="whitespace-pre-wrap break-all">
        {renderSegments.map((seg, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stable order within line
            key={i}
            className={cn(
              ansiClass(seg.ansi),
              seg.isMatch && 'rounded-sm bg-amber-300/70 text-zinc-900',
              seg.isCurrentMatch && 'bg-orange-400 text-zinc-900',
            )}
          >
            {seg.text}
          </span>
        ))}
      </span>
    </div>
  )
}

function ansiClass(seg: AnserJsonEntry): string {
  const classes: string[] = []
  switch (seg.fg) {
    case 'rgb(187, 0, 0)':
    case 'red':
      classes.push('text-red-400')
      break
    case 'rgb(0, 187, 0)':
    case 'green':
      classes.push('text-emerald-400')
      break
    case 'rgb(187, 187, 0)':
    case 'yellow':
      classes.push('text-amber-300')
      break
    case 'rgb(0, 0, 187)':
    case 'blue':
      classes.push('text-sky-400')
      break
    case 'rgb(187, 0, 187)':
    case 'magenta':
      classes.push('text-fuchsia-400')
      break
    case 'rgb(0, 187, 187)':
    case 'cyan':
      classes.push('text-cyan-300')
      break
    case 'rgb(255, 255, 255)':
    case 'white':
      classes.push('text-zinc-50')
      break
    case 'rgb(85, 85, 85)':
    case 'rgb(0, 0, 0)':
      classes.push('text-zinc-500')
      break
  }
  const decos =
    typeof seg.decoration === 'string'
      ? [seg.decoration]
      : Array.isArray(seg.decorations)
        ? seg.decorations
        : []
  if (decos.includes('bold')) classes.push('font-bold')
  if (decos.includes('dim')) classes.push('opacity-60')
  if (decos.includes('italic')) classes.push('italic')
  if (decos.includes('underline')) classes.push('underline')
  return classes.join(' ')
}
