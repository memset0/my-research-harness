import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { wikiKinds } from '../lib/wiki-kinds'
import { WikiKindGuide, WikiKindHelp } from './wiki-kind-help'

describe('Wiki type guide', () => {
  it('opens by keyboard, renders every kind and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<WikiKindHelp />)
    const trigger = screen.getByRole('button', { name: '打开 Wiki 类型指南' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Wiki 类型指南' })).toBeInTheDocument()
    for (const kind of wikiKinds) {
      expect(screen.getByText(kind.zh.purpose)).toBeInTheDocument()
      expect(screen.getByText(kind.zh.distinctions)).toBeInTheDocument()
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes through the primitive close button', async () => {
    const user = userEvent.setup()
    render(<WikiKindHelp />)
    await user.click(screen.getByRole('button', { name: '打开 Wiki 类型指南' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('renders an ordinary config entry and edited help without a second list', () => {
    const fixture = structuredClone(wikiKinds.find((kind) => kind.id === 'note')!)
    Object.assign(fixture, { id: 'test-guide', label: '临时指南', order: 120 })
    fixture.zh.purpose = '测试用途更新'
    fixture.zh.examples = ['测试示例更新']
    render(<WikiKindGuide kinds={[fixture]} />)
    expect(screen.getByText('test-guide')).toBeInTheDocument()
    expect(screen.getByText('测试用途更新')).toBeInTheDocument()
    expect(screen.getByText(/测试示例更新/)).toBeInTheDocument()
  })
})
