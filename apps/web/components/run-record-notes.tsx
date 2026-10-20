'use client'

import type { RunMetadata } from '@memon/core'
import type { ProjectTarget } from '../lib/api'
import { projectHost, projectName } from '../lib/api'
import { Markdown } from './markdown'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export function RunRecordNotes({
  metadata,
  project,
  documentPath,
}: {
  metadata?: RunMetadata
  project: ProjectTarget
  documentPath?: string
}) {
  if (!metadata) return null
  return (
    <div className="space-y-2 text-sm">
      <Badge variant="outline">
        {metadata.active ? 'Active in Variant' : 'Inactive in Variant'}
      </Badge>
      {metadata.description && <p className="whitespace-pre-wrap">{metadata.description}</p>}
      {metadata.assessment && (
        <p>
          <strong>{metadata.assessment.kind}</strong>: {metadata.assessment.reason}
        </p>
      )}
      {!!metadata.legacy_sections?.length && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Imported sections · deprecated format
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 border-l pl-3">
            {metadata.legacy_sections.map((section, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Imported duplicate headings retain their fixed source occurrence.
              <section key={`${index}-${section.title}`}>
                <h4 className="font-medium">{section.title}</h4>
                <Markdown
                  project={project}
                  document={
                    documentPath
                      ? {
                          project: projectName(project),
                          host: projectHost(project) ?? undefined,
                          path: documentPath,
                        }
                      : undefined
                  }
                >
                  {section.body}
                </Markdown>
              </section>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
