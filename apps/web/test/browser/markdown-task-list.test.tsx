// v3 Plan section task 5.1 — render unit test for the Markdown component
// when fed GFM task lists. Asserts:
//   - `- [ ]` and `- [x]` produce <input type="checkbox"> elements
//   - the checked state matches the bracket marker
//   - every checkbox is `disabled` (read-only in v1)
//   - clicking a checkbox does not change its checked state
//   - nested task lists (2-space indent under a parent) render as
//     additional checkbox inputs at deeper DOM depth

import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { Markdown } from '../../components/markdown'

describe('Markdown — GFM task list rendering', () => {
  it('renders `- [ ]` / `- [x]` as disabled checkbox inputs with matching checked state', () => {
    const md = ['- [x] First done', '- [ ] Second pending', '- [x] Third also done'].join('\n')
    const { container } = render(<Markdown>{md}</Markdown>)

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
    expect(boxes[2]!.checked).toBe(true)
    for (const box of Array.from(boxes)) {
      expect(box.disabled).toBe(true)
    }
  })

  it('clicking a checkbox is a no-op (read-only in v1)', () => {
    const { container } = render(<Markdown>{'- [ ] Pending task'}</Markdown>)
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })

  it('renders nested task lists at any depth as separate checkbox inputs', () => {
    const md = [
      '- [x] Outer done',
      '  - [ ] Nested pending',
      '    - [x] Deeply nested done',
      '- [ ] Outer pending',
      '  - [x] Nested done',
    ].join('\n')
    const { container } = render(<Markdown>{md}</Markdown>)

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(5)

    // Confirm depth: at least one checkbox lives inside a nested <ul> /
    // <ol> (i.e. its closest ancestor list is itself nested inside another
    // list). This is the structural signal that GFM task list nesting
    // round-tripped through the renderer.
    const nested = Array.from(boxes).filter((box) => {
      const li = box.closest('li')
      const parentList = li?.parentElement
      return Boolean(parentList?.closest('li'))
    })
    expect(nested.length).toBeGreaterThan(0)
  })

  it('mixes checkbox items with free-form paragraphs and sub-headings without losing structure', () => {
    const md = [
      '- [x] Task A',
      '',
      'A reflection paragraph.',
      '',
      '### Sub-heading',
      '- [ ] Task B',
    ].join('\n')
    const { container } = render(<Markdown>{md}</Markdown>)

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)

    // Sub-heading and paragraph survive.
    expect(container.querySelector('h3')?.textContent).toBe('Sub-heading')
    expect(container.textContent).toContain('A reflection paragraph.')
  })
})
