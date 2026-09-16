import { z } from 'zod'
import { defineComponent } from '../../types'

export const CHECKLIST_STATUS_FIELDS = ['agent_completed', 'human_acknowledged', 'human_reviewed'] as const
export type ChecklistStatusField = (typeof CHECKLIST_STATUS_FIELDS)[number]

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatusField, string> = {
  agent_completed: 'Agent completed',
  human_acknowledged: 'Human acknowledged',
  human_reviewed: 'Human reviewed',
}

const statusSchema = z
  .object({
    agent_completed: z.boolean().default(false).describe('Agent-owned claim that this item is complete; independent of both human flags.'),
    human_acknowledged: z.boolean().default(false).describe('Human-owned acknowledgement that the item has been seen; never inferred or set by the Agent unprompted.'),
    human_reviewed: z.boolean().default(false).describe('Human-owned confirmation that the work was reviewed; independent of acknowledgement and completion.'),
  })
  .strict()
  .default({})
  .describe('Three independent status flags; omitted flags default to false.')

export interface ChecklistItem {
  title: string
  content: string
  status: z.infer<typeof statusSchema>
  children: ChecklistItem[]
}

export interface RawChecklistItem {
  title: string
  content?: string | null
  status?: z.input<typeof statusSchema> | null
  children?: RawChecklistItem[] | null
}

const itemSchema: z.ZodType<ChecklistItem, z.ZodTypeDef, RawChecklistItem> = z.lazy(() =>
  z
    .object({
      title: z.string().trim().min(1).describe('One-line item label.'),
      content: z.string().nullable().optional().transform((value) => value ?? '').describe('Optional plain-text detail shown when the item is expanded.'),
      status: statusSchema.nullable().optional().transform((value) => value ?? statusSchema.parse({})),
      children: z.array(itemSchema).nullable().optional().transform((value) => value ?? []).describe('Nested items in display order; state never cascades between parent and child.'),
    })
    .strict(),
)

const schema = z.object({
  items: z
    .array(itemSchema)
    .nullable()
    .transform((items) => items ?? [])
    .describe('Recursive checklist items in display order. Each item has a non-empty `title`, optional plain-text `content`, optional `children`, and independent boolean `status.agent_completed`, `status.human_acknowledged`, and `status.human_reviewed` flags (all default false).'),
})

const example = [
  '```yaml checklist@1 #release_gate',
  'items:',
  '  - title: Collect baseline measurements',
  '    status:',
  '      agent_completed: true',
  '    children:',
  '      - title: Host A',
  '        status:',
  '          human_acknowledged: true',
  '  - title: Write up the comparison',
  '```',
].join('\n')

export const descriptor = defineComponent({
  type: 'checklist',
  version: 1,
  description: 'A recursive task list with independent Agent-completed, human-acknowledged, and human-reviewed flags.',
  useWhen: 'Use for work plans, review gates, and hand-offs where the human must distinguish Agent completion from their own acknowledgement and review. Agents set `agent_completed` only after doing the work and never set either human-owned flag without an explicit request. Do not infer a parent state from its children.',
  schema,
  example,
  invalidExamples: [
    { block: example.replace('agent_completed: true', 'agent_completed: "true"'), code: 'WIKI_COMPONENT_INVALID' },
    { block: example.replace('    status:\n      agent_completed: true', '    done: true'), code: 'WIKI_COMPONENT_INVALID' },
    { block: ['```yaml checklist@1 #alias', 'items:', '  - &a', '    title: Repeated', '  - *a', '```'].join('\n'), code: 'WIKI_COMPONENT_INVALID' },
  ],
  fixtures: ['docs/wiki/note/W0010-checklist-example.md'],
})
