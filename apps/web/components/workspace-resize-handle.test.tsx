import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceResizeHandle } from './workspace-resize-handle'

function Harness({
  surface = 'drawer',
  availableWidth,
}: {
  surface?: 'drawer' | 'split'
  availableWidth?: number
}) {
  const [widthPx, setWidthPx] = useState(600)
  return (
    <aside data-slot="workspace-panel" style={{ width: `${widthPx}px` }}>
      <WorkspaceResizeHandle
        surface={surface}
        widthPx={widthPx}
        setWidthPx={setWidthPx}
        availableWidth={availableWidth}
      />
      <output data-testid="width">{widthPx}</output>
    </aside>
  )
}

describe('WorkspaceResizeHandle', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    })
  })

  it('exposes an accessible vertical separator', () => {
    const { getByRole } = render(<Harness />)
    const handle = getByRole('separator', { name: 'Resize workspace panel drawer' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '600')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('supports an artifact-appropriate label in the shared workspace slot', () => {
    const { getByRole } = render(
      <aside data-slot="workspace-panel">
        <WorkspaceResizeHandle surface="split" widthPx={480} setWidthPx={() => {}} label="Report" />
      </aside>,
    )
    expect(getByRole('separator', { name: 'Resize Report split' })).toBeInTheDocument()
  })

  it('grows left and shrinks right from the keyboard', () => {
    const { getByRole, getByTestId } = render(<Harness />)
    const handle = getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(getByTestId('width')).toHaveTextContent('616')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(getByTestId('width')).toHaveTextContent('552')
  })

  it('writes live width while dragging and commits on release', () => {
    const { container, getByRole, getByTestId } = render(<Harness />)
    const panel = container.querySelector('[data-slot="workspace-panel"]') as HTMLElement
    panel.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      x: 600,
      y: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 600,
      toJSON: () => ({}),
    })
    const handle = getByRole('separator')
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 }))
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientX: 500 }))
    expect(panel.style.width).toBe('700px')
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true, clientX: 500 }))
    expect(getByTestId('width')).toHaveTextContent('700')
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('clamps a split drag so the main region keeps 360 pixels', () => {
    const { container, getByRole, getByTestId } = render(<Harness surface="split" />)
    const panel = container.querySelector('[data-slot="workspace-panel"]') as HTMLElement
    panel.getBoundingClientRect = () =>
      ({ width: 600 }) as ReturnType<HTMLElement['getBoundingClientRect']>
    const handle = getByRole('separator')
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 }))
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: 0 }))
    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true, clientX: 0 }))
    expect(getByTestId('width')).toHaveTextContent('840')
  })

  it('clamps against the measured outlet rather than the full viewport', () => {
    const { container, getByRole, getByTestId } = render(
      <Harness surface="split" availableWidth={900} />,
    )
    const panel = container.querySelector('[data-slot="workspace-panel"]') as HTMLElement
    panel.getBoundingClientRect = () =>
      ({ width: 500 }) as ReturnType<HTMLElement['getBoundingClientRect']>
    const handle = getByRole('separator')
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 }))
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: 0 }))
    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true, clientX: 0 }))
    expect(getByTestId('width')).toHaveTextContent('540')
  })
})
