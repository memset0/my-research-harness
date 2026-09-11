/**
 * `checklist@1` - a recursive task list with three independent flags per item.
 *
 * `agent_completed` is the Agent's claim that the work is done;
 * `human_acknowledged` and `human_reviewed` belong to the human. Nothing
 * cascades: a parent is never derived from its children and no flag implies
 * another. Rendering numbers items `1`, `1.1`, `1.2`, `2`, ... from sequence
 * order; numbers are never persisted.
 */

import { parseDocument, stringify as stringifyYaml, visit } from 'yaml'
import { z } from 'zod'
import { markdownFenceFor } from '../fence'
import {
  parseComponentAttributes,
  WikiComponentBlockError,
  type WikiComponentDescriptor,
} from '../types'

export const CHECKLIST_STATUS_FIELDS = ['agent_completed', 'human_acknowledged', 'human_reviewed'] as const
export type ChecklistStatusField = (typeof CHECKLIST_STATUS_FIELDS)[number]

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatusField, string> = {
  agent_completed: 'Agent completed',
  human_acknowledged: 'Human acknowledged',
  human_reviewed: 'Human reviewed',
}

export interface ChecklistStatus {
  agent_completed: boolean
  human_acknowledged: boolean
  human_reviewed: boolean
}

export interface ChecklistItem {
  title: string
  content: string
  status: ChecklistStatus
  children: ChecklistItem[]
}

export interface ChecklistV1 {
  items: ChecklistItem[]
}

const attributes = z.object({}).strict()

const statusSchema = z
  .object({
    agent_completed: z.boolean().optional(),
    human_acknowledged: z.boolean().optional(),
    human_reviewed: z.boolean().optional(),
  })
  .strict()

interface RawItem {
  title: string
  content?: string | null
  status?: z.infer<typeof statusSchema> | null
  children?: RawItem[] | null
}

const itemSchema: z.ZodType<RawItem> = z.lazy(() =>
  z
    .object({
      title: z.string().trim().min(1),
      content: z.string().nullable().optional(),
      status: statusSchema.nullable().optional(),
      children: z.array(itemSchema).nullable().optional(),
    })
    .strict(),
)

const payloadSchema = z.object({ items: z.array(itemSchema).nullable() }).strict()

function normalizeItem(raw: RawItem): ChecklistItem {
  return {
    title: raw.title.trim(),
    content: raw.content ?? '',
    status: {
      agent_completed: raw.status?.agent_completed ?? false,
      human_acknowledged: raw.status?.human_acknowledged ?? false,
      human_reviewed: raw.status?.human_reviewed ?? false,
    },
    children: (raw.children ?? []).map(normalizeItem),
  }
}

/** Parses the YAML payload with the core schema and refuses anchors/aliases. */
export function loadChecklistYaml(payload: string): unknown {
  const document = parseDocument(payload, { schema: 'core', uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new WikiComponentBlockError('WIKI_COMPONENT_INVALID', null, 'payload must be valid YAML')
  }
  let aliased = false
  visit(document, {
    Alias: () => {
      aliased = true
      return visit.BREAK
    },
  })
  if (aliased) {
    throw new WikiComponentBlockError(
      'WIKI_COMPONENT_INVALID',
      null,
      'anchors and aliases are not allowed: every item must be written out',
    )
  }
  return document.toJS()
}

function parsePayload(payload: string, rawAttributes: Record<string, string>): ChecklistV1 {
  parseComponentAttributes({ name: 'checklist', version: 1, attributes }, rawAttributes)
  const document = loadChecklistYaml(payload)
  const result = payloadSchema.safeParse(document)
  if (!result.success) {
    const issue = result.error.issues[0]!
    const field =
      issue.code === 'unrecognized_keys'
        ? issue.keys[0]
        : issue.path.filter((segment): segment is string => typeof segment === 'string').at(-1)
    throw new WikiComponentBlockError(
      'WIKI_COMPONENT_INVALID',
      typeof field === 'string' ? field : null,
      `${issue.path.join('.') || 'payload'}: ${issue.message}`,
    )
  }
  return { items: (result.data.items ?? []).map(normalizeItem) }
}

const example = [
  '```checklist@1',
  'items:',
  '  - title: Collect baseline measurements',
  '    content: |',
  '      Run the baseline on every configured host.',
  '      Record wall time and peak memory in the Experiment.',
  '    status:',
  '      agent_completed: true',
  '    children:',
  '      - title: Host A',
  '        status:',
  '          agent_completed: true',
  '          human_acknowledged: true',
  '      - title: Host B',
  '  - title: Write up the comparison',
  '```',
].join('\n')

export const checklistV1: WikiComponentDescriptor<ChecklistV1> = {
  name: 'checklist',
  version: 1,
  description:
    'A recursive task list where Agent completion, human acknowledgement, and human review are three independent flags per item.',
  args: [
    {
      name: 'items',
      scope: 'payload',
      type: 'list of item',
      required: true,
      meaning: 'Top-level items in display order. An empty list is valid and renders nothing.',
    },
    {
      name: 'item.title',
      scope: 'payload',
      type: 'nonempty string',
      required: true,
      meaning: 'One-line label always shown beside the bold hierarchical number.',
    },
    {
      name: 'item.content',
      scope: 'payload',
      type: 'string',
      required: false,
      default: '""',
      meaning:
        'Longer plain-text description shown only after the reader expands the item; line breaks are preserved. Omit or leave empty for no expander.',
    },
    {
      name: 'item.children',
      scope: 'payload',
      type: 'list of item',
      required: false,
      default: '[]',
      meaning:
        'Nested items numbered under the parent (1.1, 1.2, ...). Always visible regardless of whether the parent content is expanded.',
    },
    {
      name: 'item.status.agent_completed',
      scope: 'payload',
      type: 'boolean',
      required: false,
      default: 'false',
      meaning:
        'Set by the Agent only after finishing that item. Does not imply either human flag and is never derived from children.',
    },
    {
      name: 'item.status.human_acknowledged',
      scope: 'payload',
      type: 'boolean',
      required: false,
      default: 'false',
      meaning:
        'Human-owned: the person has seen the item. An Agent may write it only when the user explicitly asks for that exact item.',
    },
    {
      name: 'item.status.human_reviewed',
      scope: 'payload',
      type: 'boolean',
      required: false,
      default: 'false',
      meaning:
        'Human-owned: the person has reviewed the work. Independent of acknowledgement and of Agent completion; never set it on your own initiative. Unrelated to wiki commit review marks.',
    },
  ],
  effect:
    'Renders each item with a bold dotted number, its title, and three labelled checkboxes; content stays collapsed until the reader expands it, children are always listed. On wiki reading surfaces an authenticated owner can toggle any single flag and the page file is rewritten in place (only that boolean changes) using the page write lock; elsewhere the checkboxes are disabled and marked read-only. Invalid payloads stay visible as the original fenced code with a WIKI_COMPONENT_INVALID diagnostic.',
  useWhen:
    'Use for work plans, review gates, and hand-off lists where the human must see which claims are the Agent\'s and which are theirs. Agents: set agent_completed after doing the work; leave human_acknowledged and human_reviewed alone unless the user explicitly names the item and the flag. Never tick a parent because its children are done. Do not use it for ordinary prose lists (plain Markdown) or for data tables (memon-data@1). Each item must be written out in full: YAML anchors/aliases are rejected.',
  example,
  invalidExamples: [
    {
      block: example.replace('agent_completed: true', 'agent_completed: "true"'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    {
      block: example.replace('    status:\n      agent_completed: true', '    done: true'),
      code: 'WIKI_COMPONENT_INVALID',
    },
    {
      block: ['```checklist@1', 'items:', '  - &a', '    title: Repeated', '  - *a', '```'].join('\n'),
      code: 'WIKI_COMPONENT_INVALID',
    },
  ],
  fixtures: ['mock/project-a/docs/wiki/note/W0010-checklist-example.md'],
  attributes,
  parsePayload,
  lint: () => [],
  toMarkdown(data) {
    const payload = stringifyYaml(data, { lineWidth: 0 }).trimEnd()
    const fence = markdownFenceFor(payload)
    return `${fence}checklist@1\n${payload}\n${fence}`
  },
}
