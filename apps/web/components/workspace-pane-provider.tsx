'use client'

// Root-mounted state holder for Report and wiki drawer/split surfaces.

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
import { type ReportWorkspaceController, useReportWorkspace } from '../hooks/use-report-workspace'
import { useWikiWorkspace, type WikiWorkspaceController } from '../hooks/use-wiki-workspace'
import { useWorkspacePanelWidth } from '../hooks/use-workspace-panel-width'
import { ReportPane, type ReportPaneSurface } from './report-pane'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet'
import { WikiPane, type WikiPaneSurface } from './wiki-pane'
import { WorkspaceResizeHandle } from './workspace-resize-handle'

interface ReportPaneApi {
  openReport: (reportId: string, surface?: ReportPaneSurface) => void
  closeReport: () => void
}

interface WikiPaneApi {
  openWiki: (wikiId: string, surface?: WikiPaneSurface) => void
  closeWiki: () => void
}

const ReportPaneContext = createContext<ReportPaneApi | null>(null)
const WikiPaneContext = createContext<WikiPaneApi | null>(null)

interface WorkspaceSplitContextValue {
  report: ReportWorkspaceController
  wiki: WikiWorkspaceController
  isSplit: boolean
  splitWidth: ReturnType<typeof useWorkspacePanelWidth>
  splitAvailableWidth: number | undefined
  setSplitAvailableWidth: (width: number | undefined) => void
}

const WorkspaceSplitContext = createContext<WorkspaceSplitContextValue | null>(null)
const NOOP_SET_AVAILABLE_WIDTH = (_width: number | undefined) => {}

/** Current shared-slot offset for fixed chrome such as the project footer. */
export function useWorkspaceSplitWidth(): number {
  const workspace = useContext(WorkspaceSplitContext)
  return workspace?.isSplit ? workspace.splitWidth.widthPx : 0
}

const NOOP_REPORT_API: ReportPaneApi = {
  openReport: () => {},
  closeReport: () => {},
}

const NOOP_WIKI_API: WikiPaneApi = {
  openWiki: () => {},
  closeWiki: () => {},
}

export function useReportPane(): ReportPaneApi {
  return useContext(ReportPaneContext) ?? NOOP_REPORT_API
}

export function useWikiPane(): WikiPaneApi {
  return useContext(WikiPaneContext) ?? NOOP_WIKI_API
}

export function WorkspacePaneProvider({ children }: { children: ReactNode }) {
  const [splitAvailableWidth, setSplitAvailableWidth] = useState<number>()
  const drawerWidth = useWorkspacePanelWidth('drawer')
  const splitWidth = useWorkspacePanelWidth('split', splitAvailableWidth)
  const report = useReportWorkspace()
  const wiki = useWikiWorkspace()

  const reportIsSplit =
    report.state !== null && report.project !== null && report.effectiveSurface === 'split'
  const reportIsDrawer =
    report.state !== null && report.project !== null && report.effectiveSurface === 'drawer'
  const wikiIsSplit =
    wiki.state !== null && wiki.project !== null && wiki.effectiveSurface === 'split'
  const wikiIsDrawer =
    wiki.state !== null && wiki.project !== null && wiki.effectiveSurface === 'drawer'
  const isSplit = reportIsSplit || wikiIsSplit

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return
      if (reportIsDrawer) report.closeReport()
      else if (wikiIsDrawer) wiki.closeWiki()
    },
    [report.closeReport, reportIsDrawer, wiki.closeWiki, wikiIsDrawer],
  )

  return (
    <ReportPaneContext.Provider
      value={{ openReport: report.openReport, closeReport: report.closeReport }}
    >
      <WikiPaneContext.Provider value={{ openWiki: wiki.openWiki, closeWiki: wiki.closeWiki }}>
        <WorkspaceSplitContext.Provider
          value={{
            report,
            wiki,
            isSplit,
            splitWidth,
            splitAvailableWidth,
            setSplitAvailableWidth,
          }}
        >
          {children}

          <Sheet open={reportIsDrawer || wikiIsDrawer} onOpenChange={handleOpenChange}>
            <SheetContent
              side="right"
              showCloseButton={false}
              data-slot="workspace-panel"
              data-panel-kind={reportIsDrawer ? 'report' : 'wiki'}
              data-surface="drawer"
              aria-label={reportIsDrawer ? 'Report drawer' : 'Wiki drawer'}
              className="flex max-w-none flex-col gap-0 p-0 sm:max-w-none"
              style={{ width: `${drawerWidth.widthPx}px`, maxWidth: 'none' }}
            >
              {reportIsDrawer ? (
                <WorkspaceResizeHandle surface="drawer" label="report" {...drawerWidth} />
              ) : (
                <WorkspaceResizeHandle surface="drawer" label="wiki page" {...drawerWidth} />
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
              ) : null}
            </SheetContent>
          </Sheet>
        </WorkspaceSplitContext.Provider>
      </WikiPaneContext.Provider>
    </ReportPaneContext.Provider>
  )
}

/** Stable page-content boundary for the shared Report/wiki right-side slot. */
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
    throw new Error('WorkspaceSplitOutlet must be used within WorkspacePaneProvider')
  }

  const { report, wiki, splitWidth, splitAvailableWidth } = workspace
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
        } as CSSProperties
      }
    >
      <div
        data-slot="workspace-main-region"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
      >
        {children}
      </div>
      {isSplit && (showReport || showWiki) ? (
        <aside
          data-slot="workspace-panel"
          data-panel-kind={showReport ? 'report' : 'wiki'}
          data-surface="split"
          aria-label={showReport ? 'Report split panel' : 'Wiki split panel'}
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
          ) : null}
        </aside>
      ) : null}
    </div>
  )
}
