'use client'

// Root-mounted state holder for in-page browser-terminal surfaces.
// Target identity is kept separately from presentation, so the same tmux
// session or Herdr workspace can move between drawer, split, and popup
// without changing backend process ownership.

import { Columns2, ExternalLink, PanelRightOpen, X } from 'lucide-react'
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useIsMobile } from '../hooks/use-mobile'
import {
  type ReportWorkspaceController,
  useReportWorkspace,
} from '../hooks/use-report-workspace'
import { useTerminalPanelWidth } from '../hooks/use-terminal-panel-width'
import { type WikiWorkspaceController, useWikiWorkspace } from '../hooks/use-wiki-workspace'
import {
  type ProjectTarget,
  projectHost,
  projectName,
  type TerminalAgentKind,
  type TerminalScopeKind,
} from '../lib/api'
import { ReportPane, type ReportPaneSurface } from './report-pane'
import { WikiPane, type WikiPaneSurface } from './wiki-pane'
import { TerminalResizeHandle, WorkspaceResizeHandle } from './terminal-resize-handle'
import { TerminalView } from './terminal-view'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'

export type { TerminalScopeKind }

interface StandardDrawerState {
  kind: 'standard'
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
  sessionName: string | null
}

interface RawDrawerState {
  kind: 'raw'
  host?: string
  sessionName: string
}

interface HerdrDrawerState {
  kind: 'herdr'
  project?: ProjectTarget
  scope?: TerminalScopeKind
  slug?: string
  sessionName: string | null
}

type TerminalTargetState = StandardDrawerState | RawDrawerState | HerdrDrawerState
type WorkspaceSurface = 'drawer' | 'split'

/**
 * One active workspace surface owns the drawer/right slot at a time: the
 * terminal (component state), a Report, or a wiki page (both URL-encoded and
 * mutually exclusive in the query string). Keeping the terminal target nested
 * behind a discriminant keeps that arbitration in one provider instead of
 * three competing ones.
 */
type WorkspacePanelState = { kind: 'terminal'; target: TerminalTargetState }

export interface DrawerOpenInput {
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
}

export interface DrawerOpenRawInput {
  host?: string
  sessionName: string
}

export interface DrawerOpenHerdrInput {
  project: ProjectTarget
  scope: TerminalScopeKind
  slug: string
}

interface DrawerApi {
  open: (input: DrawerOpenInput) => void
  openRaw: (input: DrawerOpenRawInput) => void
  openHerdr: (input?: DrawerOpenHerdrInput) => void
  openSplit: (input: DrawerOpenInput) => void
  openRawSplit: (input: DrawerOpenRawInput) => void
  openHerdrSplit: (input?: DrawerOpenHerdrInput) => void
  close: () => void
}

interface ReportPaneApi {
  openReport: (reportId: string, surface?: ReportPaneSurface) => void
  closeReport: () => void
}

interface WikiPaneApi {
  openWiki: (wikiId: string, surface?: WikiPaneSurface) => void
  closeWiki: () => void
}

const TerminalDrawerContext = createContext<DrawerApi | null>(null)
const ReportPaneContext = createContext<ReportPaneApi | null>(null)
const WikiPaneContext = createContext<WikiPaneApi | null>(null)

interface WorkspaceSplitContextValue {
  panel: WorkspacePanelState | null
  report: ReportWorkspaceController
  wiki: WikiWorkspaceController
  isSplit: boolean
  splitWidth: ReturnType<typeof useTerminalPanelWidth>
  splitAvailableWidth: number | undefined
  setSplitAvailableWidth: (width: number | undefined) => void
  onSessionReady: (sessionName: string) => void
  onDrawer: () => void
  onSplit: () => void
  onPopOut: () => void
  onClose: () => void
}

const WorkspaceSplitContext = createContext<WorkspaceSplitContextValue | null>(null)
const NOOP_SET_AVAILABLE_WIDTH = (_width: number | undefined) => {}

/** Current shared-slot offset for fixed chrome such as the project footer. */
export function useWorkspaceSplitWidth(): number {
  const workspace = useContext(WorkspaceSplitContext)
  return workspace?.isSplit ? workspace.splitWidth.widthPx : 0
}

const NOOP_API: DrawerApi = {
  open: () => {},
  openRaw: () => {},
  openHerdr: () => {},
  openSplit: () => {},
  openRawSplit: () => {},
  openHerdrSplit: () => {},
  close: () => {},
}

const NOOP_REPORT_API: ReportPaneApi = {
  openReport: () => {},
  closeReport: () => {},
}

const NOOP_WIKI_API: WikiPaneApi = {
  openWiki: () => {},
  closeWiki: () => {},
}

export function useTerminalDrawer(): DrawerApi {
  const ctx = useContext(TerminalDrawerContext)
  if (!ctx) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        'useTerminalDrawer: no <TerminalDrawerProvider> in tree. Falling back to a no-op API.',
      )
    }
    return NOOP_API
  }
  return ctx
}

export function useReportPane(): ReportPaneApi {
  return useContext(ReportPaneContext) ?? NOOP_REPORT_API
}

export function useWikiPane(): WikiPaneApi {
  return useContext(WikiPaneContext) ?? NOOP_WIKI_API
}

function deriveStandardSessionName(state: StandardDrawerState): string {
  return (
    state.sessionName ??
    `memon-${state.agent === 'none' ? 'terminal' : state.agent}-${projectName(state.project)}--${state.scope}--${state.slug}`
  )
}

function popupUrlFor(state: TerminalTargetState): string {
  if (state.kind === 'standard') {
    const params = new URLSearchParams({
      project: projectName(state.project),
      scope: state.scope,
      slug: state.slug,
      agent: state.agent,
    })
    const host = projectHost(state.project)
    if (host) params.set('host', host)
    return `/terminal-popup?${params.toString()}`
  }
  if (state.kind === 'herdr') {
    const params = new URLSearchParams({ integration: 'herdr' })
    if (state.project && state.scope && state.slug) {
      params.set('project', projectName(state.project))
      params.set('scope', state.scope)
      params.set('slug', state.slug)
      const host = projectHost(state.project)
      if (host) params.set('host', host)
    }
    return `/terminal-popup?${params.toString()}`
  }
  const params = new URLSearchParams({ sessionName: state.sessionName })
  if (state.host) params.set('host', state.host)
  return `/terminal-popup?${params.toString()}`
}

function popupTargetFor(state: TerminalTargetState): string {
  const host =
    state.kind === 'raw'
      ? state.host
      : state.project
        ? (projectHost(state.project) ?? undefined)
        : undefined
  const prefix = host ? `${host}-` : ''
  if (state.kind === 'standard') return `memon-popup-${prefix}${deriveStandardSessionName(state)}`
  if (state.kind === 'herdr') {
    return `memon-popup-${prefix}memon-herdr${state.slug ? `-${state.slug}` : ''}`
  }
  return `memon-popup-${prefix}${state.sessionName}`
}

function titleFor(state: TerminalTargetState): ReactNode {
  if (state.kind === 'standard') {
    return (
      <>
        {state.agent} · {deriveStandardSessionName(state)}
      </>
    )
  }
  if (state.kind === 'herdr') return <>Herdr{state.slug ? ` · ${state.slug}` : ''}</>
  return state.sessionName
}

function descriptionFor(state: TerminalTargetState): ReactNode {
  if (state.kind === 'herdr') {
    return <>Closing this panel detaches the browser client. Herdr keeps workspaces alive.</>
  }
  return (
    <>
      Closing this panel keeps ttyd and the tmux session alive. Manage sessions at{' '}
      <code className="rounded bg-muted px-1">/manage/tmux</code>.
    </>
  )
}

interface TerminalPanelContentProps {
  state: TerminalTargetState
  surface: WorkspaceSurface
  onSessionReady: (sessionName: string) => void
  onDrawer: () => void
  onSplit: () => void
  onPopOut: () => void
  onClose: () => void
}

function TerminalPanelContent({
  state,
  surface,
  onSessionReady,
  onDrawer,
  onSplit,
  onPopOut,
  onClose,
}: TerminalPanelContentProps) {
  const actions = (
    <div className="flex shrink-0 items-center gap-1">
      {surface === 'drawer' ? (
        <Button variant="outline" size="sm" onClick={onSplit} className="hidden md:inline-flex">
          <Columns2 className="size-3" />
          Split right
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onDrawer}>
          <PanelRightOpen className="size-3" />
          Drawer
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onPopOut}>
        <ExternalLink className="size-3" />
        Pop out
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close terminal">
        <X className="size-3.5" />
      </Button>
    </div>
  )

  const header =
    surface === 'drawer' ? (
      <SheetHeader className="border-b p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <SheetTitle className="truncate font-mono text-xs">{titleFor(state)}</SheetTitle>
            <SheetDescription className="text-[11px]">{descriptionFor(state)}</SheetDescription>
          </div>
          {actions}
        </div>
      </SheetHeader>
    ) : (
      <header className="flex items-start justify-between gap-2 border-b p-3 pb-2">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-xs font-medium text-foreground">
            {titleFor(state)}
          </h2>
          <p className="text-[11px] text-muted-foreground">{descriptionFor(state)}</p>
        </div>
        {actions}
      </header>
    )

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === 'standard' ? (
          <TerminalView
            mode="standard"
            project={state.project}
            scope={state.scope}
            slug={state.slug}
            agent={state.agent}
            onSessionReady={onSessionReady}
            source="drawer"
          />
        ) : state.kind === 'raw' ? (
          <TerminalView
            mode="raw"
            host={state.host}
            sessionName={state.sessionName}
            source="drawer"
          />
        ) : (
          <TerminalView
            mode="herdr"
            {...(state.project && state.scope && state.slug
              ? { project: state.project, scope: state.scope, slug: state.slug }
              : {})}
            onSessionReady={onSessionReady}
            source="drawer"
          />
        )}
      </div>
    </>
  )
}

export function TerminalDrawerProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<WorkspacePanelState | null>(null)
  const [surface, setSurface] = useState<WorkspaceSurface>('drawer')
  const [splitAvailableWidth, setSplitAvailableWidth] = useState<number>()
  const isMobile = useIsMobile()
  const drawerWidth = useTerminalPanelWidth('drawer')
  const splitWidth = useTerminalPanelWidth('split', splitAvailableWidth)
  const report = useReportWorkspace()
  const wiki = useWikiWorkspace()

  // Opening a terminal evicts whichever document currently owns the slot.
  const prepareTerminalSurface = useCallback(() => {
    if (report.state) report.closeReport()
    if (wiki.state) wiki.closeWiki()
  }, [report.closeReport, report.state, wiki.closeWiki, wiki.state])

  const open = useCallback(
    (input: DrawerOpenInput) => {
      prepareTerminalSurface()
      setSurface('drawer')
      setPanel({
        kind: 'terminal',
        target: { kind: 'standard', ...input, sessionName: null },
      })
    },
    [prepareTerminalSurface],
  )

  const openRaw = useCallback(
    (input: DrawerOpenRawInput) => {
      prepareTerminalSurface()
      setSurface('drawer')
      setPanel({
        kind: 'terminal',
        target: { kind: 'raw', ...input },
      })
    },
    [prepareTerminalSurface],
  )

  const openHerdr = useCallback(
    (input?: DrawerOpenHerdrInput) => {
      prepareTerminalSurface()
      setSurface('drawer')
      setPanel({
        kind: 'terminal',
        target: { kind: 'herdr', ...(input ?? {}), sessionName: null },
      })
    },
    [prepareTerminalSurface],
  )

  const requestedSplitSurface = useCallback((): WorkspaceSurface => {
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'drawer' : 'split'
  }, [])

  const openSplit = useCallback(
    (input: DrawerOpenInput) => {
      prepareTerminalSurface()
      setSurface(requestedSplitSurface())
      setPanel({
        kind: 'terminal',
        target: { kind: 'standard', ...input, sessionName: null },
      })
    },
    [prepareTerminalSurface, requestedSplitSurface],
  )

  const openRawSplit = useCallback(
    (input: DrawerOpenRawInput) => {
      prepareTerminalSurface()
      setSurface(requestedSplitSurface())
      setPanel({
        kind: 'terminal',
        target: { kind: 'raw', ...input },
      })
    },
    [prepareTerminalSurface, requestedSplitSurface],
  )

  const openHerdrSplit = useCallback(
    (input?: DrawerOpenHerdrInput) => {
      prepareTerminalSurface()
      setSurface(requestedSplitSurface())
      setPanel({
        kind: 'terminal',
        target: { kind: 'herdr', ...(input ?? {}), sessionName: null },
      })
    },
    [prepareTerminalSurface, requestedSplitSurface],
  )

  const close = useCallback(() => setPanel(null), [])
  const showDrawer = useCallback(() => setSurface('drawer'), [])
  const showSplit = useCallback(() => setSurface(requestedSplitSurface()), [requestedSplitSurface])

  useEffect(() => {
    if (isMobile && surface === 'split') setSurface('drawer')
  }, [isMobile, surface])

  useEffect(() => {
    if (report.state || wiki.state) setPanel(null)
  }, [report.state, wiki.state])

  const terminalIsSplit = panel !== null && surface === 'split' && !isMobile
  const reportIsSplit =
    report.state !== null && report.project !== null && report.effectiveSurface === 'split'
  const reportIsDrawer =
    report.state !== null && report.project !== null && report.effectiveSurface === 'drawer'
  const wikiIsSplit =
    wiki.state !== null && wiki.project !== null && wiki.effectiveSurface === 'split'
  const wikiIsDrawer =
    wiki.state !== null && wiki.project !== null && wiki.effectiveSurface === 'drawer'
  const isSplit = reportIsSplit || wikiIsSplit || terminalIsSplit

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return
      if (reportIsDrawer) report.closeReport()
      else if (wikiIsDrawer) wiki.closeWiki()
      else if (!terminalIsSplit) close()
    },
    [close, report.closeReport, reportIsDrawer, terminalIsSplit, wiki.closeWiki, wikiIsDrawer],
  )

  const handleSessionReady = useCallback((sessionName: string) => {
    setPanel((prev) => {
      if (!prev) return prev
      const { target } = prev
      if (target.kind === 'standard' || target.kind === 'herdr') {
        return { ...prev, target: { ...target, sessionName } }
      }
      return prev
    })
  }, [])

  const handlePopOut = useCallback(() => {
    setPanel((cur) => {
      if (!cur) return cur
      window.open(
        popupUrlFor(cur.target),
        popupTargetFor(cur.target),
        'popup,width=1200,height=800',
      )
      return null
    })
  }, [])

  return (
    <TerminalDrawerContext.Provider
      value={{
        open,
        openRaw,
        openHerdr,
        openSplit,
        openRawSplit,
        openHerdrSplit,
        close,
      }}
    >
      <ReportPaneContext.Provider
        value={{ openReport: report.openReport, closeReport: report.closeReport }}
      >
        <WikiPaneContext.Provider
          value={{ openWiki: wiki.openWiki, closeWiki: wiki.closeWiki }}
        >
          <WorkspaceSplitContext.Provider
            value={{
              panel,
              report,
              wiki,
              isSplit,
              splitWidth,
              splitAvailableWidth,
              setSplitAvailableWidth,
              onSessionReady: handleSessionReady,
              onDrawer: showDrawer,
              onSplit: showSplit,
              onPopOut: handlePopOut,
              onClose: close,
            }}
          >
            {children}

            <Sheet
              open={reportIsDrawer || wikiIsDrawer || (panel !== null && !terminalIsSplit)}
              onOpenChange={handleOpenChange}
            >
              <SheetContent
                side="right"
                showCloseButton={false}
                data-slot="workspace-panel"
                data-panel-kind={
                  reportIsDrawer ? 'report' : wikiIsDrawer ? 'wiki' : 'terminal'
                }
                data-surface="drawer"
                aria-label={
                  reportIsDrawer
                    ? 'Report drawer'
                    : wikiIsDrawer
                      ? 'Wiki drawer'
                      : 'Terminal drawer'
                }
                className="flex max-w-none flex-col gap-0 p-0 sm:max-w-none"
                style={{ width: `${drawerWidth.widthPx}px`, maxWidth: 'none' }}
              >
                {reportIsDrawer ? (
                  <WorkspaceResizeHandle surface="drawer" label="report" {...drawerWidth} />
                ) : wikiIsDrawer ? (
                  <WorkspaceResizeHandle surface="drawer" label="wiki page" {...drawerWidth} />
                ) : (
                  <TerminalResizeHandle surface="drawer" {...drawerWidth} />
                )}
                {reportIsDrawer && report.state && report.project ? (
                  <>
                    <SheetTitle className="sr-only">Report {report.state.reportId}</SheetTitle>
                    <SheetDescription className="sr-only">
                      Read and switch this Report without leaving the current page.
                    </SheetDescription>
                    <ReportPane
                      project={report.project}
                      reportId={report.state.reportId}
                      surface="drawer"
                      onSwitch={report.switchReport}
                      onSurfaceChange={report.moveReport}
                      onClose={report.closeReport}
                    />
                  </>
                ) : wikiIsDrawer && wiki.state && wiki.project ? (
                  <>
                    <SheetTitle className="sr-only">Wiki page {wiki.state.wikiId}</SheetTitle>
                    <SheetDescription className="sr-only">
                      Read and switch this wiki page without leaving the current page.
                    </SheetDescription>
                    <WikiPane
                      project={wiki.project}
                      wikiId={wiki.state.wikiId}
                      surface="drawer"
                      onSwitch={wiki.switchWiki}
                      onSurfaceChange={wiki.moveWiki}
                      onClose={wiki.closeWiki}
                    />
                  </>
                ) : panel ? (
                  <TerminalPanelContent
                    state={panel.target}
                    surface="drawer"
                    onSessionReady={handleSessionReady}
                    onDrawer={showDrawer}
                    onSplit={showSplit}
                    onPopOut={handlePopOut}
                    onClose={close}
                  />
                ) : (
                  <SheetTitle className="sr-only">terminal</SheetTitle>
                )}
              </SheetContent>
            </Sheet>
          </WorkspaceSplitContext.Provider>
        </WikiPaneContext.Provider>
      </ReportPaneContext.Provider>
    </TerminalDrawerContext.Provider>
  )
}

/**
 * Stable page-content boundary for the shared right-side workspace slot.
 *
 * Layouts mount this below their AppBar/header. Opening or closing a split
 * changes only classes and the terminal aside; the left React subtree stays
 * mounted. The terminal, a Report, and a wiki page all render through this
 * same mutually-exclusive slot.
 */
export function WorkspaceSplitOutlet({ children }: { children: ReactNode }) {
  const workspace = useContext(WorkspaceSplitContext)
  const shellRef = useRef<HTMLDivElement>(null)
  const isSplit = workspace?.isSplit ?? false
  const setSplitAvailableWidth = workspace?.setSplitAvailableWidth ?? NOOP_SET_AVAILABLE_WIDTH

  useEffect(() => {
    if (!isSplit) {
      setSplitAvailableWidth(undefined)
      return
    }
    const shell = shellRef.current
    if (!shell) return

    const updateAvailableWidth = () => {
      const measured = shell.getBoundingClientRect().width
      if (Number.isFinite(measured) && measured > 0) setSplitAvailableWidth(measured)
    }
    updateAvailableWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateAvailableWidth)
      return () => window.removeEventListener('resize', updateAvailableWidth)
    }

    const observer = new ResizeObserver(updateAvailableWidth)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [isSplit, setSplitAvailableWidth])

  if (!workspace) {
    throw new Error('WorkspaceSplitOutlet must be used within TerminalDrawerProvider')
  }

  const { panel, report, wiki, splitWidth, splitAvailableWidth, ...actions } = workspace
  const showReport =
    report.state !== null && report.project !== null && report.effectiveSurface === 'split'
  const showWiki =
    !showReport && wiki.state !== null && wiki.project !== null && wiki.effectiveSurface === 'split'

  return (
    <div
      ref={shellRef}
      data-slot="workspace-split-outlet"
      data-surface={isSplit ? 'split' : 'normal'}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      style={
        {
          '--workspace-split-width': isSplit ? `${splitWidth.widthPx}px` : '0px',
          // Compatibility for CSS outside this change while it migrates.
          '--terminal-split-width': isSplit ? `${splitWidth.widthPx}px` : '0px',
        } as CSSProperties
      }
    >
      <div
        data-slot="workspace-main-region"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
      >
        {children}
      </div>
      {isSplit && (showReport || showWiki || panel) ? (
        <aside
          data-slot="workspace-panel"
          data-panel-kind={showReport ? 'report' : showWiki ? 'wiki' : panel?.kind}
          data-surface="split"
          aria-label={
            showReport
              ? 'Report split panel'
              : showWiki
                ? 'Wiki split panel'
                : 'Terminal split panel'
          }
          className="relative z-40 flex h-full min-h-0 shrink-0 flex-col border-l bg-popover text-xs/relaxed text-popover-foreground shadow-lg"
          style={{ width: `${splitWidth.widthPx}px` }}
        >
          {showReport ? (
            <>
              <WorkspaceResizeHandle
                surface="split"
                label="report"
                {...splitWidth}
                availableWidth={splitAvailableWidth}
              />
              <ReportPane
                project={report.project!}
                reportId={report.state!.reportId}
                surface="split"
                onSwitch={report.switchReport}
                onSurfaceChange={report.moveReport}
                onClose={report.closeReport}
              />
            </>
          ) : showWiki ? (
            <>
              <WorkspaceResizeHandle
                surface="split"
                label="wiki page"
                {...splitWidth}
                availableWidth={splitAvailableWidth}
              />
              <WikiPane
                project={wiki.project!}
                wikiId={wiki.state!.wikiId}
                surface="split"
                onSwitch={wiki.switchWiki}
                onSurfaceChange={wiki.moveWiki}
                onClose={wiki.closeWiki}
              />
            </>
          ) : panel ? (
            <>
              <TerminalResizeHandle
                surface="split"
                {...splitWidth}
                availableWidth={splitAvailableWidth}
              />
              <TerminalPanelContent
                state={panel.target}
                surface="split"
                onSessionReady={actions.onSessionReady}
                onDrawer={actions.onDrawer}
                onSplit={actions.onSplit}
                onPopOut={actions.onPopOut}
                onClose={actions.onClose}
              />
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  )
}
