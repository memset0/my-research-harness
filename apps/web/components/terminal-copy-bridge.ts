import { isManageTmuxNavShortcut } from '../app/manage/tmux/keyboard-nav'
import type { TerminalViewSource } from './terminal-view'

interface CopyShortcutInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function isTerminalCopyShortcut(event: CopyShortcutInput): boolean {
  if (event.key.toLowerCase() !== 'c' || event.altKey) return false
  const ctrlShift = event.ctrlKey && event.shiftKey && !event.metaKey
  const macCommand = event.metaKey && !event.ctrlKey
  return ctrlShift || macCommand
}

export function copyTerminalSelection(doc: Document): boolean {
  try {
    return doc.execCommand('copy')
  } catch {
    return false
  }
}

interface AttachTerminalCopyBridgeInput {
  doc: Document
  win: Window
  parentWindow: Window
  source: TerminalViewSource | undefined
}

function stopTerminalEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

/**
 * Installs memon's same-origin bridge into ttyd's document.
 *
 * ttyd/xterm owns the actual terminal selection and its `copy` event
 * handler. The bridge invokes that native handler for conventional copy
 * shortcuts; it never reads xterm private state or changes mouse input.
 */
export function attachTerminalCopyBridge({
  doc,
  win,
  parentWindow,
  source,
}: AttachTerminalCopyBridgeInput): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTerminalCopyShortcut(event)) {
      stopTerminalEvent(event)
      copyTerminalSelection(doc)
      return
    }

    if (source !== 'manage' || !isManageTmuxNavShortcut(event)) return
    stopTerminalEvent(event)
    parentWindow.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  win.addEventListener('keydown', onKeyDown, { capture: true })
  doc.addEventListener('keydown', onKeyDown, { capture: true })

  return () => {
    try {
      win.removeEventListener('keydown', onKeyDown, { capture: true })
    } catch {
      // The iframe window may already be torn down.
    }
    try {
      doc.removeEventListener('keydown', onKeyDown, { capture: true })
    } catch {
      // The iframe document may already have been replaced.
    }
  }
}
