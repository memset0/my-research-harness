'use client'

import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import {
  CHECKLIST_STATUS_FIELDS,
  CHECKLIST_STATUS_LABEL,
  type ChecklistItem,
  type ChecklistV1,
} from '../../lib/wiki-components/checklist@1'
import { cn } from '../../lib/utils'
import { Checkbox } from '../ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Label } from '../ui/label'
import { useChecklistWrite } from './checklist-write-context'

const READ_ONLY_NO_CONTEXT = 'read-only here: open the page in the wiki to change it'

export function ChecklistBlock({
  data,
  sourceLine,
  payload,
}: {
  data: ChecklistV1
  /** 1-based opening-fence line in the rendered body; null when unknown. */
  sourceLine: number | null
  payload: string
}) {
  const write = useChecklistWrite()
  const readOnlyReason =
    write === null ? READ_ONLY_NO_CONTEXT : sourceLine === null ? 'read-only: block position unknown' : write.readOnlyReason
  if (data.items.length === 0) return null
  return (
    <ol
      className="not-prose @container my-4 flex list-none flex-col gap-2 p-0"
      data-wiki-checklist=""
      data-wiki-checklist-readonly={readOnlyReason ?? undefined}
      title={readOnlyReason ?? undefined}
    >
      {data.items.map((item, index) => (
        <ChecklistRow
          key={`${index + 1}`}
          item={item}
          number={`${index + 1}`}
          path={[index]}
          disabled={readOnlyReason !== null || write?.pending === true}
          onToggle={(field, value) => {
            if (!write || sourceLine === null) return
            write.toggle({ bodyLine: sourceLine, payload, path: [index], field, value })
          }}
          onToggleChild={(path, field, value) => {
            if (!write || sourceLine === null) return
            write.toggle({ bodyLine: sourceLine, payload, path, field, value })
          }}
        />
      ))}
    </ol>
  )
}

type ToggleHandler = (
  path: readonly number[],
  field: (typeof CHECKLIST_STATUS_FIELDS)[number],
  value: boolean,
) => void

function ChecklistRow({
  item,
  number,
  path,
  disabled,
  onToggle,
  onToggleChild,
}: {
  item: ChecklistItem
  number: string
  path: readonly number[]
  disabled: boolean
  onToggle: (field: (typeof CHECKLIST_STATUS_FIELDS)[number], value: boolean) => void
  onToggleChild: ToggleHandler
}) {
  const [open, setOpen] = useState(false)
  const idBase = useId()
  const hasContent = item.content.trim().length > 0
  return (
    <li className="flex flex-col gap-1" data-wiki-checklist-item={number}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-1.5 gap-y-1 @xl:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
            {hasContent ? (
              <CollapsibleTrigger
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`${open ? 'Collapse' : 'Expand'} item ${number}`}
              >
                <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
              </CollapsibleTrigger>
            ) : (
              <span aria-hidden className="mt-0.5 inline-block size-5 shrink-0" />
            )}
            <span className="min-w-0 text-sm leading-6">
              <strong className="mr-2 tabular-nums" data-wiki-checklist-number="">
                {number}
              </strong>
              <span>{item.title}</span>
            </span>
          <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs @xl:col-start-3 @xl:pl-3">
            {CHECKLIST_STATUS_FIELDS.map((field) => {
              const id = `${idBase}-${field}`
              return (
                <span key={field} className="inline-flex items-center gap-1.5">
                  <Checkbox
                    id={id}
                    checked={item.status[field]}
                    disabled={disabled}
                    data-wiki-checklist-field={field}
                    onCheckedChange={(checked) => onToggle(field, checked === true)}
                  />
                  <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
                    {CHECKLIST_STATUS_LABEL[field]}
                  </Label>
                </span>
              )
            })}
          </div>
        </div>
        {hasContent && (
          <CollapsibleContent>
            <p
              className="mt-1 whitespace-pre-line pl-[1.625rem] text-sm text-muted-foreground"
              data-wiki-checklist-content=""
            >
              {item.content.replace(/\n$/, '')}
            </p>
          </CollapsibleContent>
        )}
      </Collapsible>
      {item.children.length > 0 && (
        <ol className="@container ml-5 flex list-none flex-col gap-2 p-0">
          {item.children.map((child, index) => (
            <ChecklistRow
              key={`${number}.${index + 1}`}
              item={child}
              number={`${number}.${index + 1}`}
              path={[...path, index]}
              disabled={disabled}
              onToggle={(field, value) => onToggleChild([...path, index], field, value)}
              onToggleChild={onToggleChild}
            />
          ))}
        </ol>
      )}
    </li>
  )
}
