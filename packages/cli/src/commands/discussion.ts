import {
  createDiscussion,
  DiscussionError,
  type DiscussionStatus,
  listDiscussions,
  loadDiscussion,
  pendingDiscussionResponses,
  type QuestionStatus,
  replyToDiscussion,
  resolveDiscussionQuestion,
  setDiscussionStatus,
} from '@memon/core'
import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { withCliWriterLock } from '../lib/invocation.js'
import type { Globals } from '../lib/program.js'

export async function runDiscussion(
  globals: Globals,
  action: string,
  target?: string,
  options: {
    title?: string
    status?: string
    decision?: string
    note?: string
    text?: string
    expectedMtime?: number
    expectedHash?: string
  } = {},
) {
  const root = singleProjectRoot(await resolveContext(globals))
  const mutate = ['create', 'status', 'resolve', 'reply'].includes(action)
  const work = async () => {
    switch (action) {
      case 'create':
        return createDiscussion(root, target!, options.title ?? target!)
      case 'status':
        return setDiscussionStatus(root, target!, options.status as DiscussionStatus)
      case 'resolve': {
        let decision: unknown = options.decision
        if (options.decision !== undefined) {
          const [discussionId, questionId] = target!.split('/')
          const document = await loadDiscussion(root, discussionId!, true)
          const type = document.questions.find((q) => q.metadata?.id === questionId)?.metadata?.type
          if (type === 'confirm' || type === 'multi' || options.decision.trim().startsWith('"')) {
            try {
              decision = JSON.parse(options.decision)
            } catch {}
          }
        }
        return resolveDiscussionQuestion(root, target!, {
          status: options.status as QuestionStatus,
          decision,
          note: options.note,
          expectedMtime: options.expectedMtime,
          expectedHash: options.expectedHash,
        })
      }
      case 'reply':
        return replyToDiscussion(root, target!, options.text!)
      case 'show':
        return loadDiscussion(root, target!, true)
      case 'list':
        return { discussions: await listDiscussions(root, true) }
      case 'pending': {
        const pending = []
        for (const summary of await listDiscussions(root, true)) {
          const doc = await loadDiscussion(root, summary.id, true)
          for (const response of pendingDiscussionResponses(doc.events))
            pending.push({
              discussion: doc.id,
              discussionStatus: doc.status,
              target: `${doc.id}/${response.question}`,
              response,
            })
        }
        return { pending }
      }
      case 'decisions':
        return {
          decisions: (await listDiscussions(root, true)).flatMap((d) =>
            d.questions
              .filter((q) => q.status === 'DECIDED')
              .map((q) => ({ discussion: d.id, discussionStatus: d.status, ...q })),
          ),
        }
      default:
        throw new DiscussionError('BAD_REQUEST', 'Unknown discussion command')
    }
  }
  try {
    const result = mutate ? await withCliWriterLock(root, work) : await work()
    process.stdout.write(
      `${JSON.stringify(result, null, globals.format === 'human' ? 2 : undefined)}\n`,
    )
  } catch (e) {
    if (e instanceof DiscussionError) emitErrorAndExit(e.code, e.message, e.details)
    const code = (e as { code?: string }).code
    if (code === 'BAD_REQUEST' || code === 'READ_ONLY')
      emitErrorAndExit(code === 'READ_ONLY' ? 'FORBIDDEN' : code, (e as Error).message)
    if (code === 'CONFLICT') emitErrorAndExit('CONFLICT', 'Discussion changed concurrently')
    throw e
  }
}
export function registerDiscussionCommands(program: Command, globals: () => Globals) {
  const command = program
    .command('discussion')
    .description('author questions and process owner feedback')
  command
    .command('create <slug>')
    .requiredOption('--title <text>', 'discussion title')
    .action((slug: string, opts: { title: string }) =>
      runDiscussion(globals(), 'create', slug, opts),
    )
  command
    .command('list')
    .description('list discussions, including drafts')
    .action(() => runDiscussion(globals(), 'list'))
  command
    .command('show <id>')
    .option('--json', 'structured output (default)')
    .action((id: string) => runDiscussion(globals(), 'show', id))
  command
    .command('pending')
    .description('all unacknowledged owner responses, with parent lifecycle')
    .action(() => runDiscussion(globals(), 'pending'))
  command
    .command('decisions')
    .description('project decision log')
    .action(() => runDiscussion(globals(), 'decisions'))
  command
    .command('status <id>')
    .requiredOption('--status <status>', 'DRAFT|OPEN|CLOSED')
    .action((id: string, opts: { status: string }) => runDiscussion(globals(), 'status', id, opts))
  command
    .command('resolve <target>')
    .requiredOption('--status <status>', 'OPEN|DECIDED|DEFERRED|DROPPED')
    .option('--decision <value>', 'option ID, text, boolean or JSON array')
    .option('--note <text>', 'decision rationale and acknowledgement note')
    .option('--expected-mtime <ms>', 'explicit document mtime guard', Number)
    .option('--expected-hash <hash>', 'explicit document hash guard')
    .action((target: string, opts) => runDiscussion(globals(), 'resolve', target, opts))
  command
    .command('reply <target> <text>')
    .action((target: string, text: string) => runDiscussion(globals(), 'reply', target, { text }))
}
