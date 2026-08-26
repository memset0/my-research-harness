import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachTerminalCopyBridge,
  isTerminalCopyShortcut,
} from './terminal-copy-bridge'

interface FrameHarness {
  iframe: HTMLIFrameElement
  doc: Document
  win: Window
  target: HTMLDivElement
  execCopy: ReturnType<typeof vi.fn>
}

function createFrame(): FrameHarness {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  const win = iframe.contentWindow!
  const target = doc.createElement('div')
  doc.body.appendChild(target)
  const execCopy = vi.fn(() => true)
  Object.defineProperty(doc, 'execCommand', {
    configurable: true,
    value: execCopy,
  })
  return { iframe, doc, win, target, execCopy }
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((iframe) => iframe.remove())
})

describe('terminal copy shortcut detection', () => {
  it('accepts Ctrl+Shift+C and Cmd+C but not plain Ctrl+C', () => {
    expect(
      isTerminalCopyShortcut({
        key: 'c',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true)
    expect(
      isTerminalCopyShortcut({
        key: 'C',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: true,
      }),
    ).toBe(true)
    expect(
      isTerminalCopyShortcut({
        key: 'c',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(false)
  })
})

describe('attachTerminalCopyBridge', () => {
  it('copies and consumes Ctrl+Shift+C without consuming plain Ctrl+C', () => {
    const frame = createFrame()
    const cleanup = attachTerminalCopyBridge({
      doc: frame.doc,
      win: frame.win,
      parentWindow: window,
      source: 'drawer',
    })

    const copyEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    frame.target.dispatchEvent(copyEvent)
    expect(copyEvent.defaultPrevented).toBe(true)
    expect(frame.execCopy).toHaveBeenCalledWith('copy')

    frame.execCopy.mockClear()
    const interruptEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    frame.target.dispatchEvent(interruptEvent)
    expect(interruptEvent.defaultPrevented).toBe(false)
    expect(frame.execCopy).not.toHaveBeenCalled()
    cleanup()
  })

  it('does not change xterm native mouse selection behavior', () => {
    const frame = createFrame()
    const observedShiftKeys: boolean[] = []
    frame.target.addEventListener('mousedown', (event) => {
      observedShiftKeys.push(event.shiftKey)
    })
    const cleanup = attachTerminalCopyBridge({
      doc: frame.doc,
      win: frame.win,
      parentWindow: window,
      source: 'drawer',
    })

    const original = new MouseEvent('mousedown', {
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
    })
    frame.target.dispatchEvent(original)
    expect(original.defaultPrevented).toBe(false)
    expect(observedShiftKeys).toEqual([false])
    cleanup()
  })

  it('keeps manage-page navigation forwarding', () => {
    const frame = createFrame()
    const parentListener = vi.fn()
    window.addEventListener('keydown', parentListener)
    const cleanup = attachTerminalCopyBridge({
      doc: frame.doc,
      win: frame.win,
      parentWindow: window,
      source: 'manage',
    })

    frame.target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(parentListener).toHaveBeenCalledTimes(1)
    const forwarded = parentListener.mock.calls[0]?.[0] as KeyboardEvent
    expect(forwarded.key).toBe('ArrowDown')
    cleanup()
    window.removeEventListener('keydown', parentListener)
  })
})
