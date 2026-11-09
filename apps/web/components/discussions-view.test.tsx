import { ProjectRefSchema, parseDiscussion } from '@memon/core'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateDiscussion } from '../lib/api'
import type { DiscussionDetail } from '../lib/dto/discussions'
import { AnswerForm, QuestionCard } from './discussions-view'
import { SessionProvider } from './session-provider'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  mutateDiscussion: vi.fn(),
}))
vi.mock('./markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
const markdownProps = {
  project,
  resourceBaseUrl: '/api/doc-assets/project-a/docs/discussions/D0001-design',
  document: { project: 'project-a', path: 'docs/discussions/D0001-design/README.md' },
}
function question(type = 'choice') {
  return parseDiscussion(
    `---\ntitle: Design\nstatus: OPEN\n---\n## Question\n\n\`\`\`question\nid: STORE\ntype: ${type}\ncategory: custom\nstatus: OPEN\n${type === 'choice' || type === 'multi' ? 'options:\n  - id: a\n    label: Files\n  - id: b\n    label: Database\n' : ''}\`\`\`\n\nEvidence.`,
  ).questions[0]!
}
beforeEach(() => {
  vi.mocked(mutateDiscussion).mockReset()
  vi.mocked(mutateDiscussion).mockResolvedValue({} as DiscussionDetail)
  localStorage.clear()
})
describe('discussion answers', () => {
  it.each([
    'choice',
    'multi',
    'confirm',
    'text',
  ])('submits a typed %s response with a comment', async (type) => {
    const q = question(type),
      updated = vi.fn(async () => {})
    render(
      <AnswerForm
        question={q.metadata!}
        q={q}
        project={project}
        discussionId="D0001"
        markdownProps={markdownProps}
        onUpdated={updated}
      />,
    )
    if (type === 'choice') await userEvent.click(screen.getByRole('radio', { name: 'Files' }))
    if (type === 'multi') await userEvent.click(screen.getByRole('checkbox', { name: 'Files' }))
    if (type === 'confirm') await userEvent.click(screen.getByRole('radio', { name: 'Disagree' }))
    if (type === 'text')
      await userEvent.type(screen.getByLabelText('Your answer'), 'Keep it portable')
    await userEvent.type(screen.getByLabelText('Comment'), 'Please keep export')
    await userEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    await waitFor(() => expect(updated).toHaveBeenCalled())
    const answer = vi.mocked(mutateDiscussion).mock.calls[0]![3] as {
      answer: unknown
      snapshot: string
    }
    expect(answer.snapshot).toBe(q.snapshot)
    expect(answer.answer).toEqual({
      comment: 'Please keep export',
      ...(type === 'choice'
        ? { choice: 'a' }
        : type === 'multi'
          ? { choices: ['a'] }
          : type === 'confirm'
            ? { confirm: false }
            : { text: 'Keep it portable' }),
    })
  })
  it('retains an in-progress answer when the question changes and requires review', async () => {
    const q = question(),
      props = {
        question: q.metadata!,
        q,
        project,
        discussionId: 'D0001',
        markdownProps,
        onUpdated: vi.fn(async () => {}),
      }
    const { rerender } = render(<AnswerForm {...props} />)
    await userEvent.type(screen.getByLabelText('Comment'), 'Unsent answer')
    rerender(<AnswerForm {...props} q={{ ...q, snapshot: 'changed' }} />)
    expect(screen.getByLabelText('Comment')).toHaveValue('Unsent answer')
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: 'I have reviewed the current version' }),
    )
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeEnabled()
  })
  it('keeps share viewers read-only while showing category and evidence', () => {
    const q = { ...question(), displayStatus: 'OPEN' as const, history: [] }
    render(
      <SessionProvider value={{ role: 'viewer', scopeProjects: ['project-a'] }}>
        <QuestionCard
          q={q}
          project={project}
          doc={{ status: 'OPEN' } as DiscussionDetail}
          storageKey="test"
          markdownProps={markdownProps}
          changed={false}
          onUpdated={vi.fn(async () => {})}
        />
      </SessionProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull()
    expect(screen.getByText('custom')).toBeInTheDocument()
    expect(screen.getByText('Evidence.')).toBeInTheDocument()
  })
})
